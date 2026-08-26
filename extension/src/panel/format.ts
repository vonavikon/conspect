// Перенесено из прежнего content.ts: форматирование длительности, тексты ошибок
// по reason, frontmatter и имя файла для .md-экспорта.

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
  not_configured: "Сервер не настроен. Откройте настройки расширения и укажите адрес сервера и токен.",
  http_error: "Сервис конспектов недоступен. Попробуйте позже.",
  exception: "Не получилось связаться с сервисом. Попробуйте ещё раз.",
  no_content: "Не слышу речи в видео.",
  stream_closed: "Соединение прервалось. Попробуйте ещё раз.",
  rate_limited: "Слишком много запросов. Подождите минуту и попробуйте снова.",
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

// Универсальное склонение существительного по числу: forms = [1, 2–4, 5+].
// 11–14 всегда множественное (5+). «1 конспект / 2 конспекта / 5 конспектов».
export function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Основные тезисы конспекта — заголовки секций (## …), очищенные от таймкода и звёздочек.
// Для превью в архиве/попапе: показываем TL;DR + этот список + «Читать полностью», не весь текст.
export function extractTeasers(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    let label = m[1].replace(/\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/, "").trim();
    label = label.replace(/\*\*/g, "").trim();
    if (label) out.push(label);
  }
  return out.slice(0, 8);
}

// Минут сэкономлено: длина видео минус ~3 мин на чтение конспекта. Короткие (<4 мин) — 0.
// Эвристика: бэкенд агрегатов не отдаёт, считаем на клиенте (кабинет, панель, ридер).
export function savedMinutes(sec?: number | null): number {
  if (!sec || sec <= 240) return 0;
  return Math.floor(sec / 60) - 3;
}

// Суммарное/среднее сэкономлено по списку длительностей дайджестов.
// count — все конспекты (для надписи «N конспектов»). avg — по всем конспектам
// (totalMin/count), не только по saved>0: иначе единственный короткий ролик давал
// «в среднем —» вместо осмысленного числа. Канон .cab-saved: total и avg по списку.
export function totalSaved(secs: (number | null | undefined)[]): { totalMin: number; count: number; avgMin: number } {
  const totalMin = secs.map(savedMinutes).reduce((a, b) => a + b, 0);
  const count = secs.length;
  const avgMin = count ? Math.round(totalMin / count) : 0;
  return { totalMin, count, avgMin };
}

// Разделить conspectus на TL;DR («Главная мысль») и тело. TL;DR — первый блок до
// первого «## » (как в макете rp-tldr). Если conspectus начинается с «## » — TL;DR пуст.
// Отступы в начале строк снимаем: модель иногда ставит 4 пробела, и marked читает это
// как code-блок — второй абзац уезжает в моноширинный отступ «где-то с середины».
export function splitTldr(md: string): { tldr: string; body: string } {
  const s = md.replace(/^\s+/, "");
  const idx = s.search(/^##\s/m);
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

// YouTube videoId из URL — для сравнения «чей ролик» (лента/related) и автозакрытия
// панели при SPA-навигации. На мусорном href фолбэк на саму строку, без выброса.
export function videoId(href: string): string {
  try {
    return new URL(href, location.origin).searchParams.get("v") ?? href;
  } catch {
    return href;
  }
}

// Стабильный ключ кэша по видео: djb2-хэш videoId. Один и тот же ролик с разными
// query-параметрами (list/t) попадает в один кэш-слот.
export function hashUrl(url: string): string {
  let h = 5381;
  const s = videoId(url);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

// Дата «DD.MM» из unix-секунд — для строк таблицы кабинета и недавних в попапе.
export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// Скачать текст как файл: Blob + object URL + клик по <a>. Общая механика .md-экспорта
// из кабинета, ридера и панели; имя/текст обёртки формируют по-своему.
export function downloadBlob(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}
