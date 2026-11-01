import { marked } from "marked";
import DOMPurify from "dompurify";

// marked passes raw HTML through by default, and the content comes from an LLM —
// sanitizing is mandatory. DOMPurify removes <script>, on* attributes, javascript: by default;
// we additionally forbid style/iframe/embed — markdown does not need them.
marked.setOptions({ gfm: true, breaks: false });

// mode sets the styling of section headings "## (MM:SS) …" (prompt) or "## … (MM:SS)":
//  • "panel"  — §07: the timecode disappears, an amber dot before the heading (.rp-h style).
//  • "reader" — §08: the timecode goes into an amber .tc badge right of the heading (.rd-sh).
//  • undefined (TL;DR blocks) — headings are untouched.
export function renderMarkdown(md: string, mode?: "panel" | "reader"): string {
  const raw = marked.parse(md ?? "", { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "iframe", "embed", "object", "form", "input", "button"],
    FORBID_ATTR: ["style"],
  });
  const headed = mode ? transformSectionHeadings(clean, mode) : clean;
  // In panel mode we wrap each section (h2 + its content) in <section class="rp-sec">:
  // this way p/ul get margin:0 as in the layout (.rp-body p/ul{margin:0}), and the
  // inter-section gap comes from .rp-sec{margin-bottom:13px}. Without the wrapper, zero
  // margins would glue paragraphs and lists together.
  const wrapped = mode === "panel" ? wrapPanelSections(headed) : headed;
  // Timecodes (C2) are attached AFTER sanitize: DOMPurify with ALLOW_DATA_ATTR:false would strip
  // our data-t. We work over the DOM, not a regex over the string — this way we do not touch tag
  // attributes (href/src/title) and do not wrap what is already inside an <a>.
  // In the reader (§08, a separate tab without a player) there is nothing to seek — clickable timecodes
  // would be a dead button role. We leave them as plain text.
  return mode === "reader" ? wrapped : linkTimecodes(wrapped);
}

// Groups top-level blocks into h2 sections: each h2 opens a new <section
// class="rp-sec">; everything up to the next h2 goes inside. Content before the first h2 (if any)
// forms its own section. A DOM walk, not a regex — correct for nested tags.
function wrapPanelSections(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const sections: HTMLElement[] = [];
  let current: HTMLElement | null = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === "H2") {
      if (current) sections.push(current);
      current = document.createElement("section");
      current.className = "rp-sec";
      current.appendChild(node);
    } else {
      if (!current) {
        current = document.createElement("section");
        current.className = "rp-sec";
      }
      current.appendChild(node);
    }
  }
  if (current) sections.push(current);
  container.innerHTML = "";
  for (const s of sections) container.appendChild(s);
  return container.innerHTML;
}

// "## (MM:SS) Title" (prompt format) or "## Title (MM:SS)" → marked produces
// <h2>(MM:SS) Title</h2>. At call time the timecode is still text (linkTimecodes has not
// run yet), so a regex over the string is safe. clean — DOMPurify-sanitized output.
function transformSectionHeadings(html: string, mode: "panel" | "reader"): string {
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (whole, attrs: string | undefined, inner: string) => {
    // A timecode at the start (prompt) or at the end (fallback parsing).
    let label = inner;
    let tc = "";
    const lead = /^\(\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*/.exec(inner);
    const trail = /\s*\(\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*$/.exec(inner);
    if (lead) { tc = lead[1]; label = inner.slice(lead[0].length); }
    else if (trail) { tc = trail[1]; label = inner.slice(0, trail.index); }
    if (!tc) return whole;
    const a = attrs ?? "";
    if (mode === "panel") return `<h2${a}>${label}</h2>`;
    return `<h2${a}><span class="tc">${tc}</span><span class="rd-sh-t">${label}</span></h2>`;
  });
}

// MM:SS or H:MM:SS. \b cuts off variants like 1:234 (4 digits) and ID-like 12:34:56:78.
const TS_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g;

function toSec(m: RegExpExecArray): number | null {
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (b > 59) return null;
  if (m[3] !== undefined) {
    const h = a;
    const c = parseInt(m[3], 10);
    if (h > 23 || c > 59) return null; // H:MM:SS — hours up to 23
    return h * 3600 + b * 60 + c;
  }
  if (a > 99) return null; // MM:SS — minutes up to 99 (long lectures)
  return a * 60 + b;
}

function linkTimecodes(html: string): string {
  if (!html) return html;
  const container = document.createElement("div");
  container.innerHTML = html; // html — already DOMPurify-sanitized output (see renderMarkdown)
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.nodeValue && TS_RE.test(node.nodeValue)) {
      // do not wrap if the text is already inside a link (double nesting)
      // or inside a section heading (there the timecode is a standalone amber .tc badge,
      // see transformSectionHeadings; the reader is a separate tab without a player, no seek needed)
      let p: Node | null = node.parentNode;
      let skip = false;
      while (p && p !== container) {
        const n = p.nodeName;
        if (n === "A" || /^H[1-6]$/.test(n)) { skip = true; break; }
        p = p.parentNode;
      }
      if (!skip) targets.push(node);
    }
    TS_RE.lastIndex = 0;
    node = walker.nextNode() as Text | null;
  }
  for (const text of targets) {
    const value = text.nodeValue ?? "";
    TS_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = TS_RE.exec(value))) {
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      const sec = toSec(m);
      if (sec === null) {
        // invalid parse (e.g. 12:99) — leave as text
        frag.appendChild(document.createTextNode(m[0]));
      } else {
        const a = document.createElement("a");
        a.className = "md-ts";
        a.setAttribute("data-t", String(sec));
        a.setAttribute("role", "button");
        a.setAttribute("title", `Перейти к ${m[0]}`);
        a.textContent = m[0]; // textContent, not innerHTML — safe
        frag.appendChild(a);
      }
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    text.parentNode?.replaceChild(frag, text);
  }
  return container.innerHTML;
}
