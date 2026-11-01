import crypto from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Config } from "./config.js";
import { normalizeYouTubeUrl } from "./pipeline/youtube.js";
import type { DigestStreamOutcome } from "./pipeline/orchestrator.js";

type Orchestrator = {
  digestStream(url: string, signal?: AbortSignal): Promise<DigestStreamOutcome>;
};

export type AppDeps = {
  cfg: Config;
  orchestrator: Orchestrator;
};

const REASON_STATUS: Record<string, ContentfulStatusCode> = {
  invalid_url: 400,
  too_long: 413,
  no_captions: 422,
  empty_transcript: 422,
  no_content: 422,
  unavailable: 502,
  conspectus_failed: 502,
};

const urlSchema = z.string().trim().url();

export function createApp(deps: AppDeps) {
  const { cfg, orchestrator } = deps;
  const app = new Hono();

  const allowed = cfg.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  app.use("*", cors({
    origin: allowed.length === 1 && allowed[0] === "*"
      ? "*"
      : (origin) => (origin && allowed.includes(origin) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  }));

  app.onError((err, c) => {
    const status = (err as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return c.json({ error: err.message || "error" }, status as ContentfulStatusCode);
    }
    console.error("[api] unhandled", err);
    return c.json({ error: "internal" }, 500);
  });

  // Shared secret between the extension and the server. Without it, anyone who learns
  // the public server's address burns the owner's LLM key. Constant-time comparison.
  const requireToken = async (c: Context, next: () => Promise<void>) => {
    const h = c.req.header("authorization") ?? "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = Buffer.from(m?.[1] ?? "");
    const want = Buffer.from(cfg.sharedToken);
    if (token.length !== want.length || !crypto.timingSafeEqual(token, want)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };

  // Rate limit: global protection against burning the LLM key. The server knows one token, not
  // users, so the limits are shared. inFlight — concurrent generations; stamps —
  // starts over the last minute (sliding window). Defense-in-depth: a leaked token
  // limits the damage but does not cancel it.
  let inFlight = 0;
  const stamps: number[] = [];

  app.get("/health", (c) => c.json({ ok: true, version: "1" }));

  // Keepalive: the extension keeps the connection alive with short GET /ping requests. Breaks
  // in these log lines show that the extension's service worker fell asleep or closed.
  app.get("/ping", (c) => c.json({ ok: true }));

  // Digest streaming (SSE): meta → delta… → done. Live reveal in the extension +
  // long videos do not die on a gateway timeout (chunks keep flying).
  app.post("/digest/stream", requireToken, bodyLimit({
    // The request body is just {"url":"..."}, a couple hundred bytes. Without a limit, a leaked token +
    // a megabyte JSON body gives a memory DoS: c.req.json() is parsed BEFORE the rate limit.
    maxSize: 64 * 1024,
    onError: (c) => c.json({ ok: false, reason: "http_error" }, 413),
  }), async (c) => {
    const body = await c.req.json().catch(() => null) as { url?: string } | null;
    const parsed = z.object({ url: urlSchema }).safeParse(body);
    if (!parsed.success) return c.json({ ok: false, reason: "invalid_url" }, 400);
    const url = normalizeYouTubeUrl(parsed.data.url);
    if (!url) return c.json({ ok: false, reason: "invalid_url" }, 400);

    // Sliding window per minute + a cap on concurrent generations. Checked BEFORE streamSSE:
    // otherwise the client would get an SSE connection instead of a 429.
    const now = Date.now();
    while (stamps.length && stamps[0] <= now - 60_000) stamps.shift();
    if (inFlight >= cfg.maxConcurrentDigests || stamps.length >= cfg.rateLimitPerMin) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "rate_limited" }, 429);
    }
    inFlight++;
    stamps.push(now);

    // streamSSE returns a Response immediately; the callback holds inFlight and clears it in finally.
    // If streamSSE throws SYNCHRONOUSLY (before invoking the callback), finally never runs — the decrement
    // here mirrors the increment, otherwise the counter leaks and the server sticks in 429 until restart.
    try {
      return streamSSE(c, async (stream) => {
      // Heartbeat: an SSE ping event every 10s keeps the connection alive while the backend
      // probes+downloads captions+builds the transcript (tens of seconds for a 2h video) and
      // while the LLM "thinks" over the first token of a large transcript. Without it, Caddy/the browser
      // cut the idle connection before meta/first delta — the client gets a break, no digest.
      const hb = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }, 10000);
      // finalized — the terminal outcome is recorded. The final done/error write may
      // throw if the client closed the tab at the write moment; without the flag, catch would write
      // the error again. safeWrite swallows the break when writing the terminal event.
      let finalized = false;
      const safeWrite = (evt: { event: string; data: string }): Promise<void> =>
        stream.writeSSE(evt).catch(() => {});
      // Client cancellation (Stop/closing the panel before done): break the LLM stream. The finalized
      // flag guards against double handling if abort throws an AbortError from the read loop before
      // the loop reaches the check.
      const ac = new AbortController();
      let aborted = false;
      stream.onAbort(() => { aborted = true; clearInterval(hb); try { ac.abort(); } catch { /* already aborted */ } });

      try {
        // probe+download+transcript run HERE, after the response opens — otherwise the client
        // would wait for the first byte through the whole preparation, without a single keepalive.
        const started = await orchestrator.digestStream(url, ac.signal);
        if (!started.ok) {
          finalized = true;
          await safeWrite({ event: "error", data: JSON.stringify({ reason: started.reason }) });
          return;
        }

        await stream.writeSSE({ event: "meta", data: JSON.stringify(started.meta) });
        let tokensIn = 0, tokensOut = 0;
        for await (const chunk of started.stream) {
          if (aborted) break;
          // Chunking progress ("part i/N") — before the first merge delta, while the LLM is not
          // yet streaming text. The client shows it in the loading header.
          if ("progress" in chunk) {
            await stream.writeSSE({ event: "progress", data: JSON.stringify(chunk.progress) });
            continue;
          }
          // no_content arrives mid-stream: the ERROR: no-content marker from the LLM.
          // It is not a digest — an SSE error to the client.
          if ("reason" in chunk) {
            finalized = true;
            await safeWrite({ event: "error", data: JSON.stringify({ reason: chunk.reason }) });
            return;
          }
          if ("usage" in chunk && chunk.usage) { tokensIn = chunk.usage.tokensIn; tokensOut = chunk.usage.tokensOut; continue; }
          if ("delta" in chunk && chunk.delta) {
            await stream.writeSSE({ event: "delta", data: JSON.stringify({ delta: chunk.delta }) });
          }
        }
        // Canceled mid-stream: no partial digest — the client is gone.
        if (aborted) return;
        finalized = true;
        await safeWrite({ event: "done", data: JSON.stringify({ tokensIn, tokensOut }) });
      } catch (e) {
        if (aborted && !finalized) {
          finalized = true;
          return;
        }
        console.error(`[digest/stream] failed url=${url} err=${(e as Error).message ?? e}`);
        if (!finalized) {
          finalized = true;
        }
        await safeWrite({ event: "error", data: JSON.stringify({ reason: "conspectus_failed" }) });
      } finally {
        clearInterval(hb);
        inFlight--;
      }
    });
    } catch (e) {
      inFlight--;
      throw e;
    }
  });

  return app;
}
