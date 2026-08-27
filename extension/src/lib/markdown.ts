import { marked } from "marked";
import DOMPurify from "dompurify";

// marked по умолчанию пропускает raw HTML из источника, а контент приходит от LLM —
// sanitize обязателен. DOMPurify по дефолту убирает <script>, on*-атрибуты, javascript:,
// дополнительно запрещаем style/iframe/embed — markdown они не нужны.
marked.setOptions({ gfm: true, breaks: false });

// mode задаёт оформление заголовков секций «## (MM:SS) …» (промпт) или «## … (MM:SS)»:
//  • "panel"  — §07: таймкод исчезает, перед заголовком amber-точка (стиль .rp-h).
//  • "reader" — §08: таймкод уходит в amber-бейдж .tc справа от заголовка (.rd-sh).
//  • undefined (TL;DR-блоки) — заголовки не трогаются.
export function renderMarkdown(md: string, mode?: "panel" | "reader"): string {
  const raw = marked.parse(md ?? "", { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "iframe", "embed", "object", "form", "input", "button"],
    FORBID_ATTR: ["style"],
  });
  const headed = mode ? transformSectionHeadings(clean, mode) : clean;
  // В panel-режиме оборачиваем каждую секцию (h2 + её контент) в <section class="rp-sec">:
  // так p/ul получают margin:0 как в макете (.rp-body p/ul{margin:0}), а межсекционный
  // интервал обеспечивает .rp-sec{margin-bottom:13px}. Без обёртки пустые
  // margin слили бы абзацы и списки.
  const wrapped = mode === "panel" ? wrapPanelSections(headed) : headed;
  // Таймкоды (C2) навешиваем ПОСЛЕ sanitize: DOMPurify с ALLOW_DATA_ATTR:false снял бы
  // наш data-t. Работаем по DOM, а не регексом по строке — так не заденем атрибуты
  // тегов (href/src/title) и не обернём то, что уже внутри <a>.
  // В reader (§08, отдельная вкладка без плеера) seek некуда — кликабельные таймкоды
  // были бы мёртвой ролью button. Оставляем их обычным текстом.
  return mode === "reader" ? wrapped : linkTimecodes(wrapped);
}

// Группирует верхнеуровневые блоки по h2-секциям: каждый h2 открывает новую <section
// class="rp-sec">, всё до следующего h2 уходит внутрь. Контент до первого h2 (если есть)
// образует свою секцию. DOM-обход, не регекс — корректен для вложенных тегов.
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

// «## (MM:SS) Название» (формат промпта) или «## Название (MM:SS)» → marked даёт
// <h2>(MM:SS) Название</h2>. На момент вызова таймкод — ещё текст (linkTimecodes не
// бегал), регекс по строке безопасен. clean — sanitize-нутый DOMPurify.
function transformSectionHeadings(html: string, mode: "panel" | "reader"): string {
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (whole, attrs: string | undefined, inner: string) => {
    // Таймкод в начале (промпт) или в конце (запасной разбор).
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

// MM:SS или H:MM:SS. \b отсекает варианты вроде 1:234 (4 цифры) и ID-подобные 12:34:56:78.
const TS_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g;

function toSec(m: RegExpExecArray): number | null {
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (b > 59) return null;
  if (m[3] !== undefined) {
    const h = a;
    const c = parseInt(m[3], 10);
    if (h > 23 || c > 59) return null; // H:MM:SS — часы до 23
    return h * 3600 + b * 60 + c;
  }
  if (a > 99) return null; // MM:SS — минуты до 99 (длинные лекции)
  return a * 60 + b;
}

function linkTimecodes(html: string): string {
  if (!html) return html;
  const container = document.createElement("div");
  container.innerHTML = html; // html — уже sanitize-нутый DOMPurify вывод (см. renderMarkdown)
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.nodeValue && TS_RE.test(node.nodeValue)) {
      // не оборачиваем, если текст уже внутри ссылки (двойная вложенность)
      // или внутри заголовка секции (там таймкод — самостоятельный amber-бейдж .tc,
      // см. transformSectionHeadings; reader — отдельная вкладка без плеера, seek не нужен)
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
        // невалидный разбор (напр. 12:99) — оставляем текстом
        frag.appendChild(document.createTextNode(m[0]));
      } else {
        const a = document.createElement("a");
        a.className = "md-ts";
        a.setAttribute("data-t", String(sec));
        a.setAttribute("role", "button");
        a.setAttribute("title", `Перейти к ${m[0]}`);
        a.textContent = m[0]; // textContent, не innerHTML — безопасно
        frag.appendChild(a);
      }
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    text.parentNode?.replaceChild(frag, text);
  }
  return container.innerHTML;
}
