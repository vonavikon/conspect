// A TypeScript port of clean_transcript.py — removes the Python dependency from the
// self-host runtime. Logic 1:1 with the Python version: strips the rolling overlap in
// YouTube auto-captions, joins the text, and cuts it into ~60s audio paragraphs,
// each with an [MM:SS] marker. The markers let the LLM put timecodes on headings.
//
// Input: raw SRT text (as yt-dlp returns it). Output: the transcript body without
// frontmatter (what the Python script prints in --no-frontmatter mode, which the
// orchestrator uses).

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
};

// An equivalent of python html.unescape for the HTML5 entities that actually occur
// in SRT: named (in the dictionary) and numeric &#NNN; / &#xNNN;.
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(code)) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

// SRT timing line: '00:01:23,400 --> 00:01:25,000'. Returns the start in seconds (int).
export function parseTiming(line: string): number | null {
  const m = line.trim().match(
    /^(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/,
  );
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  return h * 3600 + mi * 60 + s;
}

// Returns [start_sec, text] for each SRT block (index and timing are dropped).
export function parseSrtBlocks(raw: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const parts = block.trim().split("\n");
    if (parts.length < 3) continue;
    const start = parseTiming(parts[1]);
    if (start === null) continue;
    const text = unescapeHtml(parts.slice(2).join(" ").trim());
    if (text) out.push([start, text]);
  }
  return out;
}

// Strips the auto-captions rolling overlap. Returns [word, start_sec] — every
// surviving word carries the start of its SRT block, so the timing reaches the paragraphs.
export function dedupRolling(blocks: Array<[number, string]>): Array<[string, number]> {
  const kept: Array<[string, number]> = [];
  let prevWords: string[] = [];
  for (const [start, line] of blocks) {
    const words = line.match(/\S+/g) ?? [];
    if (!words.length) continue;
    // The largest k where prev[-k:] == words[:k].
    const maxK = Math.min(prevWords.length, words.length);
    let overlap = 0;
    for (let k = maxK; k > 0; k--) {
      if (
        prevWords.slice(-k).join(" ").toLowerCase() === words.slice(0, k).join(" ").toLowerCase()
      ) {
        overlap = k;
        break;
      }
    }
    const newWords = words.slice(overlap);
    if (newWords.length) {
      for (const w of newWords) kept.push([w, start]);
      prevWords = words;
    }
  }
  return kept;
}

// Seconds → [H:]MM:SS for transcript markers and topic timecodes.
export function fmtTs(sec: number): string {
  const n = Math.floor(sec);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = (x: number): string => String(x).padStart(2, "0");
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// Fixes spaces before punctuation created when words are joined.
export function fixPunct(s: string): string {
  for (const sep of [",", ".", "!", "?", ";", ":", ")"]) {
    s = s.split(` ${sep}`).join(sep);
  }
  return s.split(" (").join("(");
}

// Groups words into paragraphs over a fixed window; each with an [MM:SS] prefix.
export function toParagraphs(words: Array<[string, number]>, windowSec = 60): string {
  if (!words.length) return "";
  const paragraphs: Array<[number, string[]]> = [];
  let pbuf: string[] = [];
  let pStart = words[0][1];
  for (const [w, t] of words) {
    if (!pbuf.length) {
      pStart = t;
      pbuf.push(w);
      continue;
    }
    // Close the paragraph when the window expires.
    if (t - pStart >= windowSec) {
      paragraphs.push([pStart, pbuf]);
      pbuf = [w];
      pStart = t;
    } else {
      pbuf.push(w);
    }
  }
  if (pbuf.length) paragraphs.push([pStart, pbuf]);
  return paragraphs.map(([start, buf]) => `[${fmtTs(start)}] ${fixPunct(buf.join(" "))}`).join("\n\n");
}

// Full pipeline: SRT → the transcript body without frontmatter.
export function cleanTranscript(raw: string): string {
  const blocks = parseSrtBlocks(raw);
  if (!blocks.length) throw new Error("no text blocks found in SRT");
  const words = dedupRolling(blocks);
  return toParagraphs(words);
}
