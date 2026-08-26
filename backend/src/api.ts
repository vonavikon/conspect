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

  // Общий секрет между расширением и сервером. Без него любой, кто узнал адрес
  // публичного сервера, жжёт LLM-ключ владельца. Сравнение константное по времени.
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

  // Rate limit: глобальная защита от сжигания LLM-ключа. Сервер знает один токен, а не
  // пользователей, поэтому лимиты общие. inFlight — одновременные генерации, stamps —
  // запуски за последнюю минуту (скользящее окно). Это defense-in-depth: утечка токена
  // ограничивает ущерб, но не отменяет его.
  let inFlight = 0;
  const stamps: number[] = [];

  app.get("/health", (c) => c.json({ ok: true, version: "1" }));

  // Стриминг конспекта (SSE): meta → delta… → done. live-reveal в расширении +
  // длинные видео не падают по таймауту гейтвея (чанки летят непрерывно).
  app.post("/digest/stream", requireToken, bodyLimit({
    // Тело запроса — только {"url":"..."}, пара сотен байт. Без лимита утёкший токен +
    // мегабайтный JSON-боди дают memory-DoS: c.req.json() парсится ДО rate-limit.
    maxSize: 64 * 1024,
    onError: (c) => c.json({ ok: false, reason: "http_error" }, 413),
  }), async (c) => {
    const body = await c.req.json().catch(() => null) as { url?: string } | null;
    const parsed = z.object({ url: urlSchema }).safeParse(body);
    if (!parsed.success) return c.json({ ok: false, reason: "invalid_url" }, 400);
    const url = normalizeYouTubeUrl(parsed.data.url);
    if (!url) return c.json({ ok: false, reason: "invalid_url" }, 400);

    // Скользящее окно за минуту + cap на одновременные генерации. Проверяем ДО streamSSE:
    // иначе клиент получил бы SSE-соединение, а не 429.
    const now = Date.now();
    while (stamps.length && stamps[0] <= now - 60_000) stamps.shift();
    if (inFlight >= cfg.maxConcurrentDigests || stamps.length >= cfg.rateLimitPerMin) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "rate_limited" }, 429);
    }
    inFlight++;
    stamps.push(now);

    // streamSSE возвращает Response сразу; колбэк держит inFlight и гасит его в finally.
    // Если streamSSE бросит СИНХРОННО (до вызова колбэка), finally не выполнится — декремент
    // здесь симметричен инкременту, иначе счётчик утекает и сервер залипает в 429 до рестарта.
    try {
      return streamSSE(c, async (stream) => {
      // Heartbeat: SSE-событие ping каждые 10с держит соединение живым, пока backend
      // выполняет probe+download captions+transcript (для 2ч видео — десятки секунд) и
      // пока LLM «думает» над первым токеном большого транскрипта. Без этого Caddy/браузер
      // рубят idle-соединение до meta/первого delta — клиент ловит обрыв, конспекта нет.
      const hb = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }, 10000);
      // finalized — терминальный исход зафиксирован. Финальная запись done/error может
      // бросить, если клиент закрыл вкладку в момент записи; без флага catch записал бы
      // ошибку повторно. safeWrite гасит обрыв при записи терминала.
      let finalized = false;
      const safeWrite = (evt: { event: string; data: string }): Promise<void> =>
        stream.writeSSE(evt).catch(() => {});
      // Отмена клиента (Стоп/закрытие панели до done): обрываем LLM-стрим. Флаг finalized
      // страхует от двойной обработки, если abort бросит AbortError из read-loop раньше,
      // чем цикл дойдёт до проверки.
      const ac = new AbortController();
      let aborted = false;
      stream.onAbort(() => { aborted = true; clearInterval(hb); try { ac.abort(); } catch { /* уже обрывали */ } });

      try {
        // probe+download+transcript идут ЗДЕСЬ, после открытия ответа — иначе клиент
        // ждал бы первого байта всё время подготовки, без единого keepalive.
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
          // no_content приходит во время стрима: маркер ERROR: no-content от LLM.
          // Это не конспект — клиенту SSE error.
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
        // Отмена во время стрима: частичный конспект не отдаём — клиент ушёл.
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
