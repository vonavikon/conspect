// Извлечение видео: нормализация URL, yt-dlp (probe + субтитры), выбор языка.
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const execFile = promisify(execFileCb);

export type VideoProbe = {
  title: string;
  channel: string;
  durationSec: number;
  lang: string; // raw-ключ дорожки yt-dlp (для --sub-langs): "en", "ru-orig", "en-j3PyPqV-e1s"
  langCode: string; // чистый базовый код (для меты и LLM-промпта): "en", "ru"
  hasManual: boolean;
  subsKind: "manual" | "auto";
};

const HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];

export function validateYouTubeUrl(raw: string): boolean {
  return normalizeYouTubeUrl(raw) !== null;
}

// Каноничный watch?v=ID из любой формы ссылки: watch?v=, youtu.be/, shorts/, embed/, live/.
// Один ключ кэша/биллинга независимо от &pp=, &t=, &si=, list= и прочих трекинг-параметров.
export function normalizeYouTubeUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!HOSTS.includes(u.hostname.toLowerCase())) return null;
  let id: string | null = null;
  if (u.hostname === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0];
  } else if (u.pathname === "/watch") {
    id = u.searchParams.get("v");
  } else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    if (m) id = m[1];
  }
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

// yt-dlp отдаёт automatic_captions отсортированными по коду языка, поэтому
// Object.keys()[0] почти всегда бессмысленный (ab, aa…). Для не-оригинального
// языка это ещё и машинный перевод. Выбираем по заявленному языку видео,
// затем по частым языкам, иначе любой не-служебный ключ.
const COMMON_LANGS = ["en", "ru", "es", "fr", "de", "pt", "it", "uk", "pl", "tr"];

// Служебные «дорожки» yt-dlp, не являющиеся речью: чат трансляции (live_chat) и т.п.
// Если выбрать их, yt-dlp скачает чат стрима — это не субтитры, конспект невозможен
// (баг: «субтитры не скачались: subs.live_chat.srt» через ~5с). Фильтруем до выбора.
const JUNK = /chat/i;
function pickCaptionLang(pool: string[], declared?: string): string | undefined {
  const langs = pool.filter((l) => !JUNK.test(l));
  if (!langs.length) return undefined;
  const byBase = (b: string) => langs.find((l) => {
    const lo = l.toLowerCase();
    return lo === b || lo.startsWith(`${b}-`) || lo.startsWith(`${b}.`);
  });
  if (declared) {
    const d = declared.toLowerCase();
    const exact = langs.find((l) => l.toLowerCase() === d);
    if (exact) return exact;
    const m = byBase(d.split("-")[0]);
    if (m) return m;
  }
  const orig = langs.find((l) => l.toLowerCase().endsWith("-orig"));
  if (orig) return orig;
  for (const c of COMMON_LANGS) { const m = byBase(c); if (m) return m; }
  return langs[0];
}

export type Runner = (file: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;

type Deps = { probeTimeoutSec: number; downloadTimeoutSec: number; runner?: Runner; ytdlpBin?: string };

// Путь к yt-dlp: явный YTDLP_BIN из окружения → рядом с бинарником/модулем → PATH.
// На Windows рядом с сервером может лежать yt-dlp.exe, чтобы не требовать установку
// yt-dlp в систему. В Docker (образ ставит yt-dlp в PATH) резолвится обычный yt-dlp.
export function resolveYtdlpBin(moduleDir: string): string {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;
  for (const name of ["yt-dlp.exe", "yt-dlp"]) {
    // Проверка существования выполняется синхронно один раз при старте.
    if (existsSync(path.join(moduleDir, name))) return path.join(moduleDir, name);
  }
  return "yt-dlp";
}

export function createYoutube(deps: Deps) {
  const bin = deps.ytdlpBin ?? "yt-dlp";
  const runner: Runner = deps.runner ?? (async (file, args, opts) =>
    execFile(file, args, { timeout: opts.timeout * 1000, maxBuffer: 16 * 1024 * 1024 }) as unknown as { stdout: string; stderr: string });

  async function probe(url: string): Promise<VideoProbe> {
    let out: string;
    try {
      const r = await runner(bin,
        ["--no-update", "--skip-download", "--dump-json", url],
        { timeout: deps.probeTimeoutSec });
      out = r.stdout;
    } catch (e) {
      throw new Error(`yt-dlp probe failed: ${(e as Error).message}`);
    }
    const j = JSON.parse(out) as {
      title: string; duration: number; uploader?: string; channel?: string; language?: string;
      subtitles: Record<string, unknown[]>; automatic_captions: Record<string, unknown[]>;
    };

    const duration = Number(j.duration);
    if (!duration || duration === 0 || Number.isNaN(duration)) throw new Error("нет длительности");

    const manualLangs = Object.keys(j.subtitles ?? {});
    const autoLangs = Object.keys(j.automatic_captions ?? {});
    const hasManual = manualLangs.length > 0;
    const lang = pickCaptionLang(hasManual ? manualLangs : autoLangs, j.language);
    if (!lang) throw new Error("нет субтитров");

    return {
      title: j.title ?? "Видео",
      channel: j.channel ?? j.uploader ?? "",
      durationSec: Math.round(duration),
      lang,
      langCode: lang.split(/[-.]/)[0],
      hasManual,
      subsKind: hasManual ? "manual" : "auto",
    };
  }

  async function downloadCaptions(url: string, probe: VideoProbe, outBase: string): Promise<string> {
    const flag = probe.subsKind === "manual" ? "--write-subs" : "--write-auto-subs";
    // yt-dlp пишет <outBase>.<lang>.srt
    await runner(bin,
      ["--no-update", "--skip-download", flag, "--sub-langs", probe.lang,
       "--sub-format", "srt", "-o", `${outBase}.%(ext)s`, url],
      { timeout: deps.downloadTimeoutSec });

    const srt = `${outBase}.${probe.lang}.srt`;
    try { await access(srt); } catch {
      throw new Error(`субтитры не скачались: ${srt}`);
    }
    return srt;
  }

  return { probe, downloadCaptions };
}
