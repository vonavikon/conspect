// Сборка конспекта целиком: probe + субтитры + чистка + LLM + результат (или SSE-стрим).
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

// В стриме no_content приходит не до, а во время генерации: LLM отдаёт маркер
// ERROR: no-content первым сообщением. Поэтому stream-генератор может отдать либо
// delta (текст), либо { reason: "no_content" } — api.ts транслирует в SSE error.
export type StreamChunk =
  | { delta?: string }
  | { reason: "no_content" }
  | { usage?: { tokensIn: number; tokensOut: number } }
  | { progress: { i: number; n: number } };

export type DigestStreamOutcome =
  | { ok: true; meta: { title: string; channel: string; durationSec: number; lang: string; source: string }; stream: AsyncGenerator<StreamChunk> }
  | { ok: false; reason: "invalid_url" | "too_long" | "no_captions" | "unavailable" | "empty_transcript" };

// Порог чанкинга (символов транскрипта) и размер куска. 50k ≈ 12-13k токенов — безопасно
// для контекста большинства моделей; выше — риск выхода за input-лимит. Размер куска 20k
// держит один map-вызов в рамках контекста с запасом на промпт и ответ.
const CHUNK_THRESHOLD_CHARS = 50000;
const CHUNK_SIZE_CHARS = 20000;

// Режем транскрипт на куски по границам таймкодов [MM:SS]. Граница — строка, начинающаяся
// с «[». Накопив >= chunkChars, закрываем кусок на ближайшем маркере, чтобы таймкод в
// заголовке секции ссылался на реальную строку транскрипта, а не на середину фразы.
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

        // Нет содержательной речи (музыка/тишина/шум) — LLM отдаёт маркер. Не конспект,
        // не кэшируем; списание вернётся refund в api.ts.
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

    // Стриминговый вариант: probe+transcript выполняются синхронно и возвращают результат,
    // а генерация конспекта идёт потоком. tmp-каталог чистится сразу — llm работает со
    // строкой транскрипта в памяти, файлы больше не нужны.
    // signal передаётся в LLM-стрим — отмена клиента обрывает генерацию (без сжигания токенов).
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

      // Короткий транскрипт — прежний путь: один LLM-вызов, живой стрим.
      if (transcript.length <= CHUNK_THRESHOLD_CHARS) {
        const raw = deps.llm.conspectusStream(
          { title: probe.title, channel: probe.channel, durationSec: probe.durationSec, source: url, lang: probe.langCode },
          transcript,
          signal,
        );
        return { ok: true, meta, stream: noContentGuard(raw) };
      }

      // Длинный транскрипт — map-reduce: каждый кусок в секции (молча), затем merge-сборка
      // стримится. Прогресс «часть i/N» идёт отдельными чанками до первого delta merge.
      // Токены map-фазы (sectionize) прибавляем к расходу merge — иначе done занижает счёт.
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

// Маркер «нет речи» LLM отдаёт первым сообщением без преамбулы. Буферизуем начало
// генерации: пока не превысит длину маркера и не содержит переноса — не стримим.
// Если накопленное ровно "ERROR: no-content" — отдаём { reason: "no_content" } и
// заканчиваем; иначе сбрасываем буфер одной delta и пропускаем остаток как обычно.
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
    // Реальный конспект длиннее и содержит перенос — сбрасываем буфер и стримим дальше.
    if (primer.length > MARKER.length + 8 || /\n/.test(primer)) {
      primed = true;
      yield { delta: primer };
      primer = "";
    }
  }
  // Короткий ответ (<маркер), не маркер — отдаём как есть (аномалия, но не no_content).
  if (!primed && primer.trim() && primer.trim() !== MARKER) yield { delta: primer };
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}
