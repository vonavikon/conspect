// Moved here from the former content.ts: duration formatting, error texts
// by reason, frontmatter, and the file name for .md export.

export type Meta = {
  title?: string;
  channel?: string;
  durationSec?: number;
  lang?: string;
  source?: string;
};

type DigestResp = { meta?: Meta; conspectus?: string; source?: string };

export function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export const REASON_TEXT: Record<string, string> = {
  invalid_url: "Неправильная ссылка.",
  too_long: "Видео слишком длинное. Я могу сделать конспект только для видео до 3 часов.",
  no_captions: "К сожалению, для этого видео конспект невозможен.",
  empty_transcript: "К сожалению, для этого видео конспект невозможен.",
  unavailable: "Видео недоступно.",
  conspectus_failed: "Не получилось собрать конспект. Попробуйте ещё раз.",
  not_configured: "Сервер не настроен. Добавьте файл config.json в папку расширения и перезагрузите его.",
  http_error: "Сервис конспектов недоступен. Попробуйте позже.",
  exception: "Не получилось связаться с сервисом. Попробуйте ещё раз.",
  no_content: "Не слышу речи в видео.",
  stream_closed: "Соединение прервалось. Попробуйте ещё раз.",
  busy: "Сервер занят. Попробуйте ещё раз через несколько секунд.",
};

export function wrapFrontmatter(r: DigestResp, url: string): string {
  const m = r.meta ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `source: ${JSON.stringify(url)}`,
    `title: ${JSON.stringify(m.title ?? "")}`,
    `channel: ${JSON.stringify(m.channel ?? "")}`,
    `duration: ${fmtDuration(m.durationSec)}`,
    `lang: ${m.lang ?? ""}`,
    `created: ${today}`,
    "---",
    "",
  ].join("\n");
  return fm + (r.conspectus ?? "");
}

export function fileName(title?: string): string {
  const cleaned = (title ?? "")
    .replace(/[^\wа-яА-ЯёЁ\- ]/giu, "")
    .trim()
    .slice(0, 60);
  return `${cleaned || "conspect"}.md`;
}

// Universal Russian plural of a noun by number: forms = [1, 2–4, 5+].
// 11–14 always use the plural (5+). Like "1 конспект / 2 конспекта / 5 конспектов".
export function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Structural sections of the digest — not timecoded "topics". Not listed among the teasers:
// otherwise "Основные тезисы" and "Вывод" would land in the topic list.
const STRUCTURAL_SECTION = /^(основные тезисы|вывод|выводы)$/i;
// A timecode at the start of "## (MM:SS) Topic" (prompt format) or at the end of "## Topic (MM:SS)".
const TC_LEAD = /^\(\d{1,2}:\d{2}(?::\d{2})?\)\s*/;
const TC_TRAIL = /\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/;

// The digest's main theses — topic headings (## …) cleaned of timecodes and asterisks.
// For previews in the archive/popup: we show the TL;DR + this list + "Read in full", not the whole text.
export function extractTeasers(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1].replace(TC_LEAD, "").replace(TC_TRAIL, "").replace(/\*\*/g, "").trim();
    if (label && !STRUCTURAL_SECTION.test(label)) out.push(label);
  }
  return out.slice(0, 8);
}

// The digest's topic timecodes in order — for the "Timecodes" list in the dashboard preview.
export function extractTimecodes(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const body = m[1].trim();
    const lead = /^\((\d{1,2}:\d{2}(?::\d{2})?)\)/.exec(body);
    const trail = /\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*$/.exec(body);
    const tc = lead?.[1] ?? trail?.[1];
    if (tc) out.push(tc);
  }
  return out;
}

// Minutes saved: video length minus ~3 min to read the digest. Short ones (<4 min) — 0.
// Heuristic: the backend returns no aggregates; we compute on the client (dashboard, panel, reader).
export function savedMinutes(sec?: number | null): number {
  if (!sec || sec <= 240) return 0;
  return Math.floor(sec / 60) - 3;
}

// Total/average saved over a list of digest durations.
// count — all digests (for the "N digests" label). avg — over all digests
// (totalMin/count), not only saved>0: otherwise a single short video would show
// "average —" instead of a meaningful number. Canonical .cab-saved: total and avg over the list.
export function totalSaved(secs: (number | null | undefined)[]): { totalMin: number; count: number; avgMin: number } {
  const totalMin = secs.map(savedMinutes).reduce((a, b) => a + b, 0);
  const count = secs.length;
  const avgMin = count ? Math.round(totalMin / count) : 0;
  return { totalMin, count, avgMin };
}

// Minutes into a compact string: 40 мин; 5 ч 20 мин; 2 дн 3 ч. A day and above — in days
// (the dashboard's totalMin exceeds 24h at ~10 long videos; "1534 мин" is unreadable).
// Zero tails are omitted: "5 ч", "2 дн", not "5 ч 0 мин".
export function fmtSavedMin(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} ч ${m} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} дн ${rh} ч` : `${d} дн`;
}

// Split the conspectus into the TL;DR ("Main idea") and the body. The TL;DR is the first block up to
// the first "## " (as in the rp-tldr layout). If the conspectus starts with "## " — the TL;DR is empty.
// Leading indentation is stripped: the model sometimes puts 4 spaces, and marked reads that
// as a code block — the second paragraph slides into a monospace indent "somewhere from the middle".
export function splitTldr(md: string): { tldr: string; body: string } {
  const s = md.replace(/^\s+/, "");
  // The "Main idea" boundary is the first structural block: a section heading (## ) or
  // the "Disclaimer" blockquote (> ), whichever comes first. The disclaimer is body content, not TL;DR:
  // before it there is only the intro (1-2 sentences); otherwise the blockquote slid into .rp-tldr-txt,
  // which lacks the .rp-body blockquote styles — the disclaimer layout broke after the first "##".
  const headingIdx = s.search(/^##\s/m);
  const quoteIdx = s.search(/^>\s?/m);
  let idx = -1;
  if (headingIdx === -1) idx = quoteIdx;
  else if (quoteIdx === -1) idx = headingIdx;
  else idx = Math.min(headingIdx, quoteIdx);
  if (idx <= 0) return { tldr: "", body: md };
  const tldr = s
    .slice(0, idx)
    .split("\n")
    .map((l) => l.replace(/^\s+/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { tldr, body: s.slice(idx) };
}

// YouTube videoId from a URL — to tell "whose video" (feed/related) and to auto-close
// the panel on SPA navigation. On a garbage href, fall back to the string itself, no throw.
export function videoId(href: string): string {
  try {
    return new URL(href, location.origin).searchParams.get("v") ?? href;
  } catch {
    return href;
  }
}

// Stable cache key per video: a djb2 hash of the videoId. The same video with different
// query params (list/t) lands in one cache slot.
export function hashUrl(url: string): string {
  let h = 5381;
  const s = videoId(url);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

// A "DD.MM" date from unix seconds — for dashboard table rows and the popup's recents.
export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// Download text as a file: Blob + object URL + an <a> click. Shared mechanics of .md export
// from the dashboard, reader, and panel; name and wrapper text are built per call site.
export function downloadBlob(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}
