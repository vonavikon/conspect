// Личный кабинет self-host: очередь + архив конспектов из локального кэша
// chrome.storage (listDigests, полный markdown уже в кэше — по сети подтягивать
// нечего) + статистика. Настроек сервера здесь нет: адрес и токен расширение
// читает из config.json при установке (агент или install-скрипт).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { DIGESTS_KEY, type Digest } from "./lib/store";
import {
  AMBER,
  BORDER,
  CARD,
  CELL,
  CELL2,
  EASE,
  ERR,
  FONT_MONO,
  FONT_SANS,
  INPUT_BG,
  LINE,
  LINE2,
  MUT,
  OK,
  SEC,
  SHADOW_CARD,
  SURFACE,
  SURFACE_HEAD,
  TEXT,
  YT_BLUE,
  mdBodyCss,
  readerBodyCss,
  skeuoCss,
  pageTexCss,
  focusRingCss,
  reducedMotionCss,
  spinKeyframes,
} from "./theme/conspectTheme";
import { Clogo, IconCheck, IconClock, IconClose, IconDownload, IconGrip, IconRead, IconSearch, IconTrash, IconYoutube } from "./theme/icons";
import { fmtDuration, fileName, pluralRu, extractTeasers, extractTimecodes, savedMinutes, fmtSavedMin, splitTldr, totalSaved, wrapFrontmatter, downloadBlob, fmtDate, hashUrl } from "./panel/format";
import { renderMarkdown } from "./lib/markdown";
import { injectFonts } from "./lib/fonts";
import { Skeleton } from "./screens/cards";
import { useStream } from "./useStream";

function shortUrl(u: string): string {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname + (x.search || ""); } catch { return u; }
}

// Видео-id из youtube-ссылки (watch/shorts/youtu.be) — для строки очереди, где ещё
// нет заголовка: видео не начали генерировать, событие meta не приходило.
function videoIdOf(u: string): string {
  const m = u.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/);
  return m?.[1] ?? u;
}

export function Options() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { s: stream, removeFromQueue, reorderQueue } = useStream();
  // Индекс строки очереди, которую сейчас тащат (drag-and-drop перестановка).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Строка, над которой держат тащимый элемент. Индикатор места вставки.
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // Подтверждение необратимого удаления (кэш целиком / один конспект). Модалка поверх.
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => Promise<void> } | null>(null);
  // FLIP-анимация перестановки очереди: запоминаем позицию каждой строки до/после
  // изменения порядка и плавно съезжаем translateY (Web Animations API), не рывком.
  const queuePos = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-qid]"));
    const nextIds = rows.map((r) => r.dataset.qid ?? "");
    const prevIds = [...queuePos.current.keys()];
    // Анимируем только фактическую перестановку/добавление/удаление (порядок id изменился).
    // При сдвиге всего блока (баннер активного стрима сверху, title в две строки) порядок
    // тот же — без анимации, иначе очередь «дёргается» на каждом обновлении страницы.
    const sameOrder = nextIds.length === prevIds.length && nextIds.every((id, i) => id === prevIds[i]);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const r of rows) {
      const id = r.dataset.qid ?? "";
      const top = r.getBoundingClientRect().top;
      const prev = queuePos.current.get(id);
      if (!reduced && !sameOrder && prev !== undefined && Math.abs(prev - top) > 0.5) {
        r.animate(
          [{ transform: `translateY(${prev - top}px)` }, { transform: "translateY(0)" }],
          { duration: 220, easing: "cubic-bezier(.22,.61,.36,1)" },
        );
      }
      next.set(id, top);
    }
    queuePos.current = next;
  }, [stream.queue]);
  const initialExpand = new URLSearchParams(location.search).get("expand");

  async function refresh(): Promise<void> {
    setLoadingHist(true);
    const r = (await chrome.runtime.sendMessage({ type: "listDigests" })) as { digests?: Digest[] } | undefined;
    setDigests(r?.digests ?? []);
    setLoadingHist(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Живое обновление архива: SW дописывает готовый конспект в chrome.storage уже после
  // broadcast «done» (cacheDigest асинхронен), поэтому ловить момент по стриму нельзя.
  // storage.onChanged по DIGESTS_KEY срабатывает именно на фактическую запись кэша —
  // открытый кабинет перечитывает список без F5. Без скелетона: тихо подменяем список.
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== "local" || !changes[DIGESTS_KEY]) return;
      void (async () => {
        const r = (await chrome.runtime.sendMessage({ type: "listDigests" })) as { digests?: Digest[] } | undefined;
        setDigests(r?.digests ?? []);
        setLoadingHist(false);
      })();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  function onClear(): void {
    setConfirm({
      title: "Очистить кэш?",
      body: "Удалит все конспекты из локального кэша. Это действие необратимо.",
      action: async () => {
        try {
          await chrome.runtime.sendMessage({ type: "clearDigests" });
        } finally {
          setConfirm(null);
          void refresh();
        }
      },
    });
  }

  function onDelete(d: Digest): void {
    setConfirm({
      title: "Удалить конспект?",
      body: `«${d.title ?? "Без названия"}» будет удалён из кэша. Это действие необратимо.`,
      action: async () => {
        try {
          await chrome.runtime.sendMessage({ type: "deleteDigest", urlHash: d.urlHash });
        } finally {
          setConfirm(null);
          void refresh();
        }
      },
    });
  }

  function onRemoveQueue(item: { url: string; title?: string }): void {
    setConfirm({
      title: "Убрать из очереди?",
      body: `«${item.title ?? videoIdOf(item.url)}» перестанет ждать в очереди и не будет конспектироваться.`,
      action: async () => {
        removeFromQueue(item.url);
        setConfirm(null);
      },
    });
  }

  async function onDownload(d: Digest): Promise<void> {
    setDownloading(d.urlHash);
    try {
      downloadBlob(
        fileName(d.title ?? undefined),
        wrapFrontmatter({ meta: { title: d.title ?? undefined, channel: d.channel ?? undefined, durationSec: d.durationSec ?? undefined, lang: d.lang ?? undefined }, conspectus: d.markdown }, d.url),
      );
    } finally {
      setDownloading(null);
    }
  }

  const openRead = (d: Digest): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(d.urlHash)}&u=${encodeURIComponent(d.url)}`) });
  };

  // ?expand=<hash> (из попапа «недавние»): раскрыть превью этого конспекта и докрутить.
  useEffect(() => {
    if (!initialExpand || loadingHist) return;
    const row = digests.find((d) => d.urlHash === initialExpand);
    if (!row) return;
    setOpenHash(row.urlHash);
    requestAnimationFrame(() => {
      document.getElementById(`cab-row-${row.urlHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // одноразовое: зависит только от готовности списка
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExpand, loadingHist]);

  const saved = totalSaved(digests.map((d) => d.durationSec));
  const ql = q.trim().toLowerCase();
  const filtered = ql ? digests.filter((d) => (d.title ?? "").toLowerCase().includes(ql) || (d.channel ?? "").toLowerCase().includes(ql)) : digests;
  const cols = "54px 1fr 46px 118px 84px";
  const cardStyle: CSSProperties = {
    backgroundColor: CARD,
    backgroundImage: `repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 2px,transparent 2px 4px),radial-gradient(120% 90% at 50% 42%,rgba(15,15,15,0) 26%,rgba(15,15,15,.86) 100%),${SURFACE}`,
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: SHADOW_CARD,
  };
  const cardHeadStyle: CSSProperties = {
    display: "flex", alignItems: "center", gap: 11, padding: "12px 18px",
    borderBottom: `1px solid ${BORDER}`, background: SURFACE_HEAD,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)",
  };

  return (
    <div style={{ minHeight: "100vh", background: "transparent", color: TEXT, padding: "48px 20px 64px", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, font: `14px/1.55 ${FONT_SANS}`, animation: `cs-page-in .26s ${EASE} both` }}>
      <style>{`*{box-sizing:border-box}body{margin:0;${pageTexCss}}@keyframes cs-page-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}`}</style>
      <style>{skeuoCss}{focusRingCss}{spinKeyframes}{`.cs-cab-q::placeholder{color:${MUT}}.cs-set-input{width:100%;font:500 12.5px ${FONT_MONO};padding:9px 11px;border-radius:9px;border:1px solid ${BORDER};background:${INPUT_BG};color:${TEXT};box-shadow:inset 0 2px 4px rgba(0,0,0,.5),inset 0 1px 0 rgba(0,0,0,.4);transition:box-shadow .12s ${EASE},border-color .12s ${EASE}}.cs-set-input::placeholder{color:${MUT}}.cs-set-input:focus{outline:none;border-color:${AMBER};box-shadow:inset 0 2px 4px rgba(0,0,0,.5),0 0 0 2px rgba(245,166,35,.55)}.cab-expand{max-height:0;overflow:hidden;opacity:0;padding:0 18px;border-top:1px solid transparent;background:${CELL};transition:max-height .32s ${EASE},opacity .24s ${EASE},padding .32s ${EASE},border-top-color .2s ${EASE}}.cab-expand.open{max-height:1600px;opacity:1;padding:13px 18px 15px;border-top-color:#161616}.cs-cab-grid{display:grid;grid-template-columns:320px minmax(440px,1fr) 260px;gap:22px;align-items:start}@media (max-width:1500px){.cs-cab-grid{grid-template-columns:1fr 1fr}.cs-cab-archive{grid-column:1/-1}}@media (max-width:760px){.cs-cab-grid{grid-template-columns:1fr}}@keyframes cs-health-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}.cs-health-fade{animation:cs-health-fade .22s ${EASE}}`}</style>
      <style>{reducedMotionCss}</style>

      {/* --- сетка ЛК: 3 блока по горизонтали — Очередь | Архив | Статистика --- */}
      <div className="cs-cab-grid" style={{ width: "100%", maxWidth: 1720 }}>
        {/* --- очередь --- */}
        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span style={{ font: `800 15px ${FONT_SANS}`, whiteSpace: "nowrap" }}>Очередь</span>
            {stream.queue.length > 0 && (
              <span style={{ font: `600 11px ${FONT_MONO}`, color: AMBER, whiteSpace: "nowrap", flexShrink: 0 }}>{stream.queue.length}</span>
            )}
            <span style={{ flex: 1 }} />
          </div>

        {/* баннер активного стрима: генерация идёт/готова → открыть окно. */}
        {stream.status !== "idle" && stream.status !== "cancelled" && (() => {
          const done = stream.status === "done";
          const failed = stream.status === "error";
          const accent = done ? OK : failed ? ERR : AMBER;
          const bg = done
            ? "linear-gradient(180deg,rgba(46,166,111,.07),rgba(46,166,111,.02))"
            : failed
              ? "linear-gradient(180deg,rgba(226,92,92,.08),rgba(226,92,92,.02))"
              : "linear-gradient(180deg,rgba(245,166,35,.07),rgba(245,166,35,.02))";
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderBottom: `1px solid ${LINE}`, background: bg, boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", ...(done ? { background: "linear-gradient(180deg,#3ec47f,#2ea66f 50%,#1f7d52)", border: "1px solid #145c39", color: "#0d2418", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.4)" } : failed ? { background: "rgba(226,92,92,.16)", border: "1px solid rgba(226,92,92,.4)", color: ERR, fontWeight: 700, fontSize: 13 } : { background: "rgba(245,166,35,.14)", border: "1px solid rgba(245,166,35,.4)", color: AMBER }), flex: "0 0 auto" }}>
                {done ? <IconCheck size={14} /> : failed ? "!" : <Clogo size={14} busy spin />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 11px ${FONT_SANS}`, color: accent }}>{done ? "Конспект готов" : failed ? "Ошибка" : "Идёт конспект"}</div>
                <div style={{ font: `500 11px ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{failed ? (stream.error || "Не получилось") : (stream.title ?? (stream.url ? shortUrl(stream.url) : "YouTube"))}</div>
              </div>
              {done && stream.url && (
                <button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(hashUrl(stream.url))}&u=${encodeURIComponent(stream.url)}`) })} className="cs-btn sm">Читать</button>
              )}
              {stream.url && <button onClick={() => void chrome.tabs.create({ url: stream.url })} title="Открыть на YouTube" aria-label="Открыть на YouTube" className="cs-mini" style={{ color: YT_BLUE, flex: "0 0 auto" }}><IconYoutube size={15} /></button>}
            </div>
          );
        })()}

        {/* очередь (#12): ожидающие url'ы, с удалением и перестановкой drag-and-drop.
            Показываем только когда активный стрим занят и накопились ожидающие. */}
        {stream.queue.length > 0 && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${LINE}`, background: "linear-gradient(180deg,rgba(245,166,35,.06),rgba(245,166,35,.015))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stream.queue.map((item, i) => {
                const dragging = dragIdx === i;
                const over = overIdx === i && dragIdx !== i;
                return (
                  <div
                    key={item.url}
                    data-qid={item.url}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overIdx !== i) setOverIdx(i); }}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) reorderQueue(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
                      borderRadius: 8, border: `1px solid ${dragging ? "rgba(245,166,35,.5)" : LINE2}`,
                      background: dragging ? "rgba(245,166,35,.08)" : over ? "rgba(245,166,35,.05)" : CELL,
                      boxShadow: over ? "inset 0 2px 0 rgba(245,166,35,.8)" : "none",
                      cursor: dragging ? "grabbing" : "grab",
                      opacity: dragging ? 0.45 : 1,
                      transform: dragging ? "scale(.98)" : "none",
                      transition: `background .15s ${EASE}, border-color .15s ${EASE}, box-shadow .15s ${EASE}, opacity .15s ${EASE}, transform .15s ${EASE}`,
                    }}
                  >
                    <span style={{ flex: "0 0 auto", color: MUT, display: "inline-flex" }}><IconGrip size={14} /></span>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 auto", font: `700 10px ${FONT_MONO}`, color: AMBER, background: "rgba(245,166,35,.14)", border: "1px solid rgba(245,166,35,.35)" }}>{i + 1}</span>
                    <span title={item.title ?? item.url} style={{ flex: 1, minWidth: 0, font: `500 11px ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title ?? videoIdOf(item.url)}</span>
                    <button onClick={() => onRemoveQueue(item)} title="Убрать из очереди" aria-label="Убрать из очереди" className="cs-mini" style={{ flex: "0 0 auto", color: MUT }}><IconClose size={14} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stream.queue.length === 0 && (stream.status === "idle" || stream.status === "cancelled") && (
          <div style={{ padding: "16px 18px", font: `500 11.5px/1.5 ${FONT_SANS}`, color: MUT }}>Сейчас ничего не генерируется. Откройте видео на YouTube и нажмите Conspect.</div>
        )}
        </div>

        {/* --- архив --- */}
        <div className="cs-cab-archive" style={cardStyle}>
          <div style={cardHeadStyle}>
            <span style={{ font: `800 15px ${FONT_SANS}` }}>Архив</span>
            <span style={{ font: `600 11px ${FONT_MONO}`, color: MUT }}>{digests.length} {pluralRu(digests.length, ["конспект", "конспекта", "конспектов"])}</span>
            <span style={{ flex: 1 }} />
            {digests.length > 0 && <button onClick={() => void onClear()} className="cs-btn sm">Очистить кэш</button>}
          </div>

        {/* поиск */}
        <div style={{ padding: "11px 18px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, background: INPUT_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 11px", boxShadow: "inset 0 2px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(0,0,0,.4)" }}>
            <IconSearch size={15} style={{ color: MUT, flex: "0 0 auto" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию или каналу" aria-label="Поиск конспектов по названию или каналу" className="cs-cab-q" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, font: `500 12px ${FONT_SANS}`, minWidth: 0 }} />
          </div>
        </div>

        {/* шапка колонок */}
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 11, padding: "10px 18px", font: `600 10px ${FONT_SANS}`, color: MUT, letterSpacing: ".06em", textTransform: "uppercase", borderBottom: `1px solid ${LINE}` }}>
          <span>Дата</span><span>Видео</span><span>Длит.</span><span>Сохранено</span><span />
        </div>

        {loadingHist ? (
          <div style={{ padding: "14px 18px" }}><Skeleton rows={[16, 42, 42, 42, 42]} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ font: `500 12.5px/1.5 ${FONT_SANS}`, color: MUT, padding: "28px 18px", textAlign: "center" }}>{ql ? "Ничего не найдено." : "Конспектов пока нет. Откройте видео на YouTube и нажмите кнопку Conspect."}</div>
        ) : (
          filtered.map((d) => {
            const sv = savedMinutes(d.durationSec);
            const open = openHash === d.urlHash;
            const tldr = splitTldr(d.markdown).tldr;
            const teasers = extractTeasers(d.markdown);
            const timecodes = extractTimecodes(d.markdown);
            return (
              <div key={d.urlHash}>
                <div
                  id={`cab-row-${d.urlHash}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`${d.title ?? "Без названия"} — развернуть превью`}
                  onClick={() => setOpenHash(open ? null : d.urlHash)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenHash(open ? null : d.urlHash); } }}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 11, alignItems: "center", padding: "11px 18px", borderTop: `1px solid #161616`, transition: `background .15s ${EASE}`, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245,166,35,.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ font: `500 10.5px ${FONT_MONO}`, color: SEC }}>{fmtDate(d.ts)}</span>
                  <div style={{ minWidth: 0 }} title={d.url}>
                    <div style={{ font: `500 11.5px/1.3 ${FONT_SANS}`, color: TEXT, minWidth: 0 }}>{d.title ?? "Без названия"}</div>
                  </div>
                  <span style={{ font: `500 12.5px ${FONT_MONO}`, color: SEC }}>{fmtDuration(d.durationSec ?? undefined)}</span>
                  <span style={{ font: `600 12.5px ${FONT_MONO}`, color: OK }}>{sv > 0 ? fmtSavedMin(sv) : "—"}</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <button type="button" title="Прочитать" aria-label="Прочитать" onClick={() => openRead(d)} className="cs-mini"><IconRead size={15} /></button>
                    <button type="button" title="Скачать .md" aria-label="Скачать .md" onClick={() => onDownload(d)} className="cs-mini">{downloading === d.urlHash ? <Clogo size={13} busy /> : <IconDownload size={15} />}</button>
                    <button type="button" title="Открыть на YouTube" aria-label="Открыть на YouTube" onClick={() => void chrome.tabs.create({ url: d.url })} className="cs-mini"><IconYoutube size={15} /></button>
                    <button type="button" title="Удалить" aria-label="Удалить конспект" onClick={() => void onDelete(d)} className="cs-mini" style={{ color: ERR }}><IconTrash size={15} /></button>
                  </span>
                </div>

                <Expand open={open}>
                  <style>{mdBodyCss}{readerBodyCss}{`.rd-tldr-txt p{margin:0}`}</style>
                  {tldr && (
                    <div style={{ padding: 0, margin: "0 0 16px" }}>
                      <span style={{ display: "block", font: `700 9.5px ${FONT_MONO}`, color: YT_BLUE, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>Главная мысль</span>
                      <div className="rd-tldr-txt" style={{ font: `400 14px/1.65 ${FONT_SANS}`, color: SEC, textAlign: "left" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr, "reader") }} />
                    </div>
                  )}
                  {teasers.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ display: "block", font: `700 9.5px ${FONT_MONO}`, color: YT_BLUE, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>Основные тезисы</span>
                      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {teasers.map((t, i) => (
                          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0 0 6px", font: `400 14px/1.6 ${FONT_SANS}`, color: SEC }}>
                            <span style={{ flex: "0 0 auto", marginTop: 6, background: CELL2, color: MUT, font: `500 10px ${FONT_MONO}`, padding: "1px 5px", borderRadius: 3, lineHeight: 1.4 }}>{i + 1}</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {timecodes.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ display: "block", font: `700 9.5px ${FONT_MONO}`, color: YT_BLUE, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>Таймкоды</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px" }}>
                        {timecodes.map((tc, i) => (
                          <span key={i} style={{ font: `700 12px ${FONT_MONO}`, color: AMBER }}>{tc}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => openRead(d)} className="cs-btn filled block" style={{ marginTop: 12 }}><IconRead size={13} /> Читать полностью</button>
                </Expand>
              </div>
            );
          })
        )}
        </div>

        {/* --- общая статистика --- */}
        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span style={{ font: `800 15px ${FONT_SANS}` }}>Статистика</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "16px 18px", background: "linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02))", border: `1px solid ${LINE2}`, display: "grid", placeItems: "center", color: SEC, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)", flex: "0 0 auto" }}><IconClock size={18} /></span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div>
                <div style={{ font: `600 10px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 3 }}>Сохранено за всё время</div>
                <div style={{ font: `700 18px ${FONT_SANS}`, color: TEXT, whiteSpace: "nowrap" }}>{fmtSavedMin(saved.totalMin)}</div>
              </div>
              <div>
                <div style={{ font: `600 10px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 3 }}>в среднем на видео</div>
                <div style={{ font: `700 18px ${FONT_SANS}`, color: TEXT, whiteSpace: "nowrap" }}>{saved.count > 0 ? fmtSavedMin(saved.avgMin) : "—"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Модалка подтверждения — через портал в body: fixed-центрирование не зависит от
          transform-анимации корня (cs-page-in), которая иначе делает корень containing
          block и сдвигает модалку вниз страницы вместо центра вьюпорта. */}
      {confirm && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, animation: `cs-page-in .18s ${EASE} both` }} onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, width: "calc(100% - 40px)", maxWidth: 380, padding: "20px 22px", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06)" }}>
            <div style={{ font: `800 15px ${FONT_SANS}`, color: TEXT, marginBottom: 8 }}>{confirm.title}</div>
            <div style={{ font: `500 12.5px/1.55 ${FONT_SANS}`, color: SEC, marginBottom: 18 }}>{confirm.body}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="cs-btn sm" onClick={() => setConfirm(null)}>Отмена</button>
              <button className="cs-btn filled sm" style={{ background: "linear-gradient(180deg,#e25c5c,#c94a4a 50%,#a93a3a)", borderColor: "#7a2a2a", color: "#1a0a0a", textShadow: "0 1px rgba(255,255,255,.3)" }} onClick={() => void confirm.action()}>Удалить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Разворот строки архива с анимацией max-height/opacity (как .cs-pop-expand в попапе).
// При open=true монтируется и в следующем кадре раскрывается; при open=false доигрывает
// закрытие ~340мс, потом размонтируется. Содержимое держим всё это время.
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  const [cls, setCls] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      const id = requestAnimationFrame(() => setCls(true));
      return () => cancelAnimationFrame(id);
    }
    setCls(false);
    const t = setTimeout(() => setShown(false), 340);
    return () => clearTimeout(t);
  }, [open]);
  if (!shown) return null;
  return <div className={`cab-expand${cls ? " open" : ""}`}>{children}</div>;
}

injectFonts();
createRoot(document.getElementById("root")!).render(<Options />);
