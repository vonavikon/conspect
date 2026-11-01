// Full digest assembly: probe + captions + cleaning + LLM + result (or an SSE stream).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { validateYouTubeUrl, type VideoProbe } from "./youtube.js";

type Youtube = { probe(url: string): Promise<VideoProbe>; downloadCaptions(url: string, p: VideoProbe, outBase: string): Promise<string> };
type Transcript = { clean(a: { srtPath: string; outPath: string; title: string; source: string; channel: string; duration: string; lang: string }): Promise<string> };
type Llm = {
  conspectus(meta: { title: string; channel: string; durationSec: number; source: string; lang: string }, transcript: string): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  conspectusStream(meta: { title: string; channel: string; durationSec: number; source: string; lang: string }, transcript: string, signal?: AbortSignal): AsyncGenerator<{ delta?: string; usage?: { tokensIn: number; tokensOut: number } }>;
  sectionize(meta: { title: string; channel: string; durationSec: number; source: string; lang: string }, chunkText: string): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  mergeStream(meta: { title: string; channel: string; durationSec: number; source: string; lang: string }, sectionsText: string, signal?: AbortSignal): AsyncGenerator<{ delta?: string; usage?: { tokensIn: number; tokensOut: number } }>;
};

export type DigestOutcome =
  | { ok: true; meta: { title: string; channel: string; durationSec: number; lang: string; source: string }; conspectus: string; tokensIn: number; tokensOut: number }
  | { ok: false; reason: "invalid_url" | "too_long" | "no_captions" | "unavailable" | "empty_transcript" | "conspectus_failed" | "no_content" };

// In the stream, no_content arrives not before but during generation: the LLM returns the
// ERROR: no-content marker as its first message. So the stream generator may yield either
// a delta (text) or { reason: "no_content" } — api.ts translates it into an SSE error.
export type StreamChunk =
  | { delta?: string }
  | { reason: "no_content" }
  | { usage?: { tokensIn: number; tokensOut: number } }
  | { progress: { i: number; n: number } };

export type DigestStreamOutcome =
  | { ok: true; meta: { title: string; channel: string; durationSec: number; lang: string; source: string }; stream: AsyncGenerator<StreamChunk> }
  | { ok: false; reason: "invalid_url" | "too_long" | "no_captions" | "unavailable" | "empty_transcript" };

// Chunking threshold (transcript chars) and chunk size. 50k ≈ 12-13k tokens — safe for
// the context of most models; above that, the risk of exceeding the input limit. The 20k
// chunk size keeps one map call within context with headroom for the prompt and the reply.
const CHUNK_THRESHOLD_CHARS = 50000;
const CHUNK_SIZE_CHARS = 20000;

// Cut the transcript into chunks at timecode boundaries [MM:SS]. A boundary is a line starting
// with "[". Once >= chunkChars is accumulated, we close the chunk at the nearest marker, so the
// timecode in a section heading points at a real transcript line, not the middle of a phrase.
function splitTranscript(transcript: string, chunkChars = CHUNK_SIZE_CHARS): string[] {
  const lines = transcript.split("\n");
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    const isMarker = /^\[/.test(line.trimStart());
    if (cur && isMarker && cur.length >= chunkChars) {
      chunks.push(cur);
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

type Deps = { youtube: Youtube; transcript: Transcript; llm: Llm; maxDurationMin: number; workDir?: string };

export function createOrchestrator(deps: Deps) {
  const base = deps.workDir ?? tmpdir();

  return {
    async digest(url: string): Promise<DigestOutcome> {
      if (!validateYouTubeUrl(url)) return { ok: false, reason: "invalid_url" };

      let probe: VideoProbe;
      try {
        probe = await deps.youtube.probe(url);
      } catch (e) {
        const msg = (e as Error).message;
        if (/нет субтитров/.test(msg)) return { ok: false, reason: "no_captions" };
        return { ok: false, reason: "unavailable" };
      }

      if (probe.durationSec > deps.maxDurationMin * 60) return { ok: false, reason: "too_long" };

      const dir = await mkdtemp(path.join(base, "vd-"));
      try {
        const outBase = path.join(dir, "subs");
        let srtPath: string;
        try { srtPath = await deps.youtube.downloadCaptions(url, probe, outBase); }
        catch { console.error("[digest] download failed"); return { ok: false, reason: "unavailable" }; }

        const transcriptPath = path.join(dir, "transcript.md");
        let transcript: string;
        try { transcript = await deps.transcript.clean({
          srtPath, outPath: transcriptPath,
          title: probe.title, source: url, channel: probe.channel,
          duration: `${Math.max(1, Math.round(probe.durationSec / 60))} min`,
          lang: probe.langCode,
        }); }
        catch { console.error("[digest] transcript failed"); return { ok: false, reason: "empty_transcript" }; }

        if (!transcript.trim()) return { ok: false, reason: "empty_transcript" };

        let text: string, tokensIn: number, tokensOut: number;
        try { ({ text, tokensIn, tokensOut } = await deps.llm.conspectus(
          { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, source: url, lang: probe.langCode },
          transcript,
        )); }
        catch { console.error("[digest] conspectus failed"); return { ok: false, reason: "conspectus_failed" }; }

        // No meaningful speech (music/silence/noise) — the LLM returns the marker. Not a digest,
        // not cached; the charge is refunded in api.ts.
        if (text.trim() === "ERROR: no-content") return { ok: false, reason: "no_content" };

        return {
          ok: true,
          meta: { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, lang: probe.langCode, source: url },
          conspectus: text, tokensIn, tokensOut,
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },

    // Streaming variant: probe+transcript run synchronously and return the result,
    // while digest generation streams. The tmp dir is cleaned up immediately — the LLM works
    // with the transcript string in memory; the files are no longer needed.
    // signal is passed into the LLM stream — a client abort breaks generation (without burning tokens).
    async digestStream(url: string, signal?: AbortSignal): Promise<DigestStreamOutcome> {
      if (!validateYouTubeUrl(url)) return { ok: false, reason: "invalid_url" };

      let probe: VideoProbe;
      try {
        probe = await deps.youtube.probe(url);
      } catch (e) {
        if (/нет субтитров/.test((e as Error).message)) return { ok: false, reason: "no_captions" };
        return { ok: false, reason: "unavailable" };
      }
      if (probe.durationSec > deps.maxDurationMin * 60) return { ok: false, reason: "too_long" };

      const dir = await mkdtemp(path.join(base, "vd-"));
      let transcript = "";
      try {
        const outBase = path.join(dir, "subs");
        let srtPath: string;
        try { srtPath = await deps.youtube.downloadCaptions(url, probe, outBase); }
        catch { console.error("[digest] download failed"); return { ok: false, reason: "unavailable" }; }
        try {
          transcript = await deps.transcript.clean({
            srtPath, outPath: path.join(dir, "transcript.md"),
            title: probe.title, source: url, channel: probe.channel,
            duration: `${Math.max(1, Math.round(probe.durationSec / 60))} min`,
            lang: probe.langCode,
          });
        } catch (e) { console.error("[digest] transcript failed:", e); return { ok: false, reason: "empty_transcript" }; }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }

      if (!transcript.trim()) return { ok: false, reason: "empty_transcript" };

      const meta = { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, lang: probe.langCode, source: url };

      // Short transcript — the old path: one LLM call, live stream.
      if (transcript.length <= CHUNK_THRESHOLD_CHARS) {
        const raw = deps.llm.conspectusStream(
          { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, source: url, lang: probe.langCode },
          transcript,
          signal,
        );
        return { ok: true, meta, stream: noContentGuard(raw) };
      }

      // Long transcript — map-reduce: each chunk into sections (silently), then the merge assembly
      // streams. "Part i/N" progress goes as separate chunks before the first merge delta.
      // Map-phase (sectionize) tokens are added to the merge spend — otherwise done undercounts.
      const chunks = splitTranscript(transcript);
      async function* chunked(): AsyncGenerator<StreamChunk> {
        const sections: string[] = [];
        let mapIn = 0, mapOut = 0;
        for (let i = 0; i < chunks.length; i++) {
          yield { progress: { i: i + 1, n: chunks.length } };
          const s = await deps.llm.sectionize(
            { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, source: url, lang: probe.langCode },
            chunks[i],
          );
          sections.push(s.text);
          mapIn += s.tokensIn;
          mapOut += s.tokensOut;
        }
        for await (const chunk of noContentGuard(deps.llm.mergeStream(
          { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, source: url, lang: probe.langCode },
          sections.join("\n\n"),
          signal,
        ))) {
          if ("usage" in chunk && chunk.usage) {
            yield { usage: { tokensIn: chunk.usage.tokensIn + mapIn, tokensOut: chunk.usage.tokensOut + mapOut } };
          } else {
            yield chunk;
          }
        }
      }
      return { ok: true, meta, stream: chunked() };
    },
  };
}

// The LLM returns the "no speech" marker as its first message without preamble. We buffer the
// start of generation: while it does not exceed the marker length and contains no newline, we do not stream.
// If the accumulated text is exactly "ERROR: no-content" — we yield { reason: "no_content" } and
// finish; otherwise we flush the buffer as one delta and pass the rest through as usual.
async function* noContentGuard(stream: AsyncGenerator<{ delta?: string; usage?: { tokensIn: number; tokensOut: number } }>): AsyncGenerator<StreamChunk> {
  const MARKER = "ERROR: no-content";
  let primer = "";
  let primed = false;
  for await (const chunk of stream) {
    if (chunk.usage) { yield { usage: chunk.usage }; continue; }
    if (!chunk.delta) continue;
    if (primed) { yield { delta: chunk.delta }; continue; }
    primer += chunk.delta;
    if (primer.trim() === MARKER) { yield { reason: "no_content" }; return; }
    // A real digest is longer and contains a newline — flush the buffer and keep streaming.
    if (primer.length > MARKER.length + 8 || /\n/.test(primer)) {
      primed = true;
      yield { delta: primer };
      primer = "";
    }
  }
  // A short reply (< marker), not the marker — yield as is (an anomaly, but not no_content).
  if (!primed && primer.trim() && primer.trim() !== MARKER) yield { delta: primer };
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}
