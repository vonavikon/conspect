// Попап по клику на иконку. Три состояния:
//  • на YouTube (watch) → только «Недавние»; запуск конспекта идёт кнопкой под плеером
//    (content.tsx), попап — точка статуса и архива, не запуска;
//  • вне YouTube → вставить ссылку → стрим идёт live прямо в попапе;
//  • сервер не настроен → карточка-подсказка (config.json не задан).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { DIGESTS_KEY, type Digest } from "./lib/store";
import type { QueueItem } from "./streamStore";
import { fmtDuration, splitTldr, extractTeasers, fmtDate, hashUrl } from "./panel/format";
import { LoadingInline, STAGES } from "./screens/cards";
import { Clogo, IconCheck, IconChevron, IconClose, IconGrip, IconRead, IconRefresh, IconStop, IconUser, IconYoutube } from "./theme/icons";
import {
  AMBER,
  BORDER,
  CELL,
  CELL2,
  ERR,
  EASE,
  FONT_MONO,
  FONT_SANS,
  LINE,
  LINE2,
  MUT,
  OK,
  SURFACE,
  SURFACE_HEAD,
  INPUT_BG,
  SEC,
  TEXT,
  YT_BLUE,
  autofillFixCss,
  focusRingCss,
  reducedMotionCss,
  skeuoCss,
  mdBodyCss,
  panelBodyCss,
} from "./theme/conspectTheme";
import { injectFonts } from "./lib/fonts";
import { renderMarkdown } from "./lib/markdown";
import { useStream } from "./useStream";

type Status = { configured?: boolean };

function send<T>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function watchUrlOf(t: chrome.tabs.Tab | null): string | null {
  if (!t?.url) return null;
  try {
    const u = new URL(t.url);
    if (u.hostname.endsWith("youtube.com") && u.pathname === "/watch" && u.searchParams.get("v")) return t.url;
  } catch { /* не URL */ }
  return null;
}

// Видео-id из youtube-ссылки — для строки очереди без заголовка.
function videoIdOf(u: string): string {
  const m = u.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/);
  return m?.[1] ?? u;
}

export function Popup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState(false);

  const { s: stream, start: startStream, stop: stopStreamNow, removeFromQueue, reorderQueue } = useStream();
  const [dismissed, setDismissed] = useState(false);
  // Подтверждение удаления элемента очереди (попап): клик по ✕ не стирает сразу.
  const [confirmRemove, setConfirmRemove] = useState<QueueItem | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const st = await send<Status>({ type: "status" });
    setStatus(st ?? null);
    if (st?.configured) {
      const h = await send<{ digests?: Digest[] }>({ type: "listDigests" });
      setDigests(h?.digests ?? []);
    } else {
      setDigests([]);
    }
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(t ?? null);
    } catch { /* нет доступа к вкладке */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Живое обновление «Недавних»: удаление/очистка кэша в кабинете должна отражаться
  // в попапе без переоткрытия. storage.onChanged по DIGESTS_KEY перечитывает список.
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== "local" || !changes[DIGESTS_KEY]) return;
      void refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  // Недавние: клик «читать» — inline-раскрытие мини-превью прямо в попапе. Конспект уже
  // в кэше (self-host), подтягивать по сети не нужно.
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const toggleExpand = (urlHash: string): void => {
    setExpandedHash((cur) => (cur === urlHash ? null : urlHash));
  };

  const openRead = (d: Digest): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(d.urlHash)}&u=${encodeURIComponent(d.url)}`) });
  };
  const openOptions = (): void => { void chrome.runtime.openOptionsPage(); };
  const confirmRemoveQueue = (item: QueueItem): void => setConfirmRemove(item);
  const doRemoveQueue = (): void => {
    if (confirmRemove) removeFromQueue(confirmRemove.url);
    setConfirmRemove(null);
  };

  // Вне YouTube: распарсить videoId и запустить стрим через глобальный streamStore.
  // Нормализуем до watch-URL.
  function makeByUrl(): void {
    const m = urlInput.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/);
    const id = m?.[1];
    if (!id) { setUrlError(true); return; }
    setDismissed(false);
    startStream(`https://www.youtube.com/watch?v=${id}`);
  }

  const openDoneRead = (): void => {
    if (!stream.url) return;
    void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(hashUrl(stream.url))}&u=${encodeURIComponent(stream.url)}`) });
  };

  const watchUrl = watchUrlOf(tab);
  const streamOn = stream.status !== "idle";
  const showStream = streamOn && !dismissed;
  const showBanner = streamOn && stream.status !== "error" && dismissed;
  const configured = !!status?.configured;

  return (
    <div style={{ width: 300, boxSizing: "border-box", background: SURFACE, color: TEXT, font: `14px/1.55 ${FONT_SANS}` }}>
      <style>{skeuoCss}</style>
      <style>{mdBodyCss}{panelBodyCss}</style>
      <style>{focusRingCss}</style>
      <style>{reducedMotionCss}</style>
      <style>{`.pop-rec{padding:6px 6px;border-radius:8px;transition:background .15s ${EASE}}.pop-rec:hover{background:${CELL}}.cs-pop-input{flex:1;min-width:0;font:500 12.5px ${FONT_MONO};padding:9px 11px;border-radius:9px;border:1px solid ${BORDER};background:${INPUT_BG};color:${TEXT};box-shadow:inset 0 2px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(0,0,0,.4);transition:box-shadow .12s ${EASE}, border-color .12s ${EASE}}.cs-pop-input::placeholder{color:${MUT}}.cs-pop-input:focus{outline:none;border-color:${AMBER};box-shadow:inset 0 2px 4px rgba(0,0,0,.5), 0 0 0 2px rgba(245,166,35,.55)}.cs-pop-input[aria-invalid="true"]{border-color:${ERR}}.cs-pop-scroll::-webkit-scrollbar{width:6px}.cs-pop-scroll::-webkit-scrollbar-thumb{background:${LINE2};border-radius:3px}.cs-pop-scroll::-webkit-scrollbar-track{background:transparent}@keyframes cs-pop-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}.cs-pop-fade{animation:cs-pop-fade .22s ${EASE}}.cs-pop-expand{max-height:0;overflow:hidden;opacity:0;margin:0;padding:0 12px;border:1px solid transparent;border-radius:9px;background:transparent;transition:max-height .34s ${EASE},opacity .26s ${EASE},padding .34s ${EASE},margin .34s ${EASE},border-color .3s ${EASE},background .3s ${EASE}}.cs-pop-expand.open{max-height:230px;overflow-y:auto;opacity:1;margin:6px 0 8px;padding:11px 12px 12px;border-color:${LINE};background:${INPUT_BG};box-shadow:inset 0 1px 3px rgba(0,0,0,.4)}.cs-pop-expand.open::-webkit-scrollbar{width:5px}.cs-pop-expand.open::-webkit-scrollbar-thumb{background:${LINE2};border-radius:3px}.cs-pop-expand.open::-webkit-scrollbar-track{background:transparent}${autofillFixCss}`}</style>

      <PopHead onGear={openOptions} onRefresh={() => void refresh()} />

      {/* Модалка подтверждения — через портал в body, чтобы fixed-центрирование не
          зависело от transform-анимации родителя (cs-pop-fade). */}
      {confirmRemove && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, animation: `cs-pop-fade .18s ${EASE} both` }} onClick={() => setConfirmRemove(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: CELL2, border: `1px solid ${LINE2}`, borderRadius: 12, width: "calc(100% - 32px)", maxWidth: 260, padding: "16px 16px 14px", boxShadow: "0 16px 40px rgba(0,0,0,.6)" }}>
            <div style={{ font: `700 13px ${FONT_SANS}`, color: TEXT, marginBottom: 6 }}>Убрать из очереди?</div>
            <div style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, marginBottom: 14 }}>«{confirmRemove.title ?? videoIdOf(confirmRemove.url)}» перестанет ждать и не будет конспектироваться.</div>
            <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
              <button className="cs-btn sm" onClick={() => setConfirmRemove(null)}>Отмена</button>
              <button className="cs-btn filled sm" style={{ background: "linear-gradient(180deg,#e25c5c,#c94a4a 50%,#a93a3a)", borderColor: "#7a2a2a", color: "#1a0a0a", textShadow: "0 1px rgba(255,255,255,.3)" }} onClick={doRemoveQueue}>Убрать</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {!configured ? (
        <div className="pop-body" style={{ padding: "11px 13px" }}>
          <div style={{ font: `500 12.5px/1.5 ${FONT_SANS}`, color: SEC }}>
            Сервер не настроен. Добавьте файл config.json в папку расширения и перезагрузите его.
          </div>
        </div>
      ) : (
        <div className="pop-body" style={{ padding: "11px 13px" }}>
          {showStream ? (
            <StreamView
              status={stream.status as "loading" | "streaming" | "done" | "error" | "cancelled"}
              text={stream.text}
              title={stream.title}
              phase={stream.phase}
              startedAt={stream.startedAt}
              progress={stream.progress}
              error={stream.error}
              errorReason={stream.errorReason}
              url={stream.url}
              onRead={openDoneRead}
              onCancel={stopStreamNow}
              onDismiss={() => setDismissed(true)}
              onOpenYt={() => { if (stream.url) void chrome.tabs.create({ url: stream.url }); }}
            />
          ) : showBanner ? (
            <StreamBanner status={stream.status} title={stream.title} onExpand={() => setDismissed(false)} />
          ) : (
            <>
              {!watchUrl && (
                <>
                  <Divider label="Вставьте ссылку" mt={2} mb={12} mx={0} />
                  <form onSubmit={(e) => { e.preventDefault(); makeByUrl(); }}>
                    <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
                      <input
                        className="cs-pop-input"
                        placeholder="youtube.com/watch?v=…"
                        aria-label="Ссылка на видео YouTube"
                        value={urlInput}
                        aria-invalid={urlError}
                        onChange={(e) => { setUrlInput(e.target.value); setUrlError(false); }}
                      />
                      <button type="submit" className="cs-btn sm" style={{ whiteSpace: "nowrap" }}>
                        Конспект
                      </button>
                    </div>
                    {urlError && (
                      <div style={{ font: `500 11px ${FONT_SANS}`, color: ERR, marginTop: 6 }}>Не похоже на ссылку YouTube. Вставьте адрес вида youtube.com/watch?v=…</div>
                    )}
                  </form>
                </>
              )}

              <Divider label="Недавние" mt={11} mb={8} mx={0} />
              <div className="cs-pop-scroll" style={{ maxHeight: 200, overflowY: "auto" }}>
                {digests.length === 0 ? (
                  <div style={{ font: `500 12px ${FONT_SANS}`, color: MUT, padding: "10px 6px" }}>Пока нет конспектов</div>
                ) : (
                  digests.slice(0, 8).map((d) => (
                    <PopRec key={d.urlHash} d={d} open={expandedHash === d.urlHash} onToggle={() => toggleExpand(d.urlHash)} onRead={() => openRead(d)} />
                  ))
                )}
              </div>
            </>
          )}
          {stream.queue.length > 0 && (
            <QueueList queue={stream.queue} onRemove={confirmRemoveQueue} reorderQueue={reorderQueue} />
          )}
        </div>
      )}
    </div>
  );
}

// Стрим в попапе: live-текст пишется прямо в теле по мере поступления, а не только спиннер.
// При done — TL;DR + тезисы + «Читать полностью» и «Открыть на YouTube». Свернуть → баннер.
export function StreamView(props: {
  status: "loading" | "streaming" | "done" | "error" | "cancelled";
  text: string;
  title: string | null;
  phase: 0 | 1 | 2;
  startedAt: number | null;
  progress: { i: number; n: number } | null;
  error: string;
  errorReason?: string;
  url: string;
  onRead: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onOpenYt: () => void;
}) {
  const { status, text, title, phase, startedAt, progress, error, errorReason, onRead, onCancel, onDismiss, onOpenYt } = props;
  const hasText = text.trim().length > 0;
  const secondaryBtn = (onClick: () => void, label: string): ReactNode => (
    <button onClick={onClick} className="cs-btn sm">{label}</button>
  );
  return (
    <div style={{ paddingBottom: 6 }}>
      {title && (
        <div style={{ font: `500 11.5px/1.35 ${FONT_SANS}`, color: SEC, marginBottom: 11, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{title}</div>
      )}
      {(status === "loading" || (status === "streaming" && !hasText)) && (
        <div key="loading" className="cs-pop-fade">
          <LoadingInline phase={phase} startedAt={startedAt} progress={progress} />
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <button onClick={onCancel} className="cs-btn sm" style={{ flex: 1 }}>Отмена</button>
            {secondaryBtn(onDismiss, "Свернуть")}
          </div>
        </div>
      )}
      {status === "streaming" && hasText && (
        <div key="streaming" className="cs-pop-fade">
          <StreamPreview text={text} />
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <button onClick={onCancel} className="cs-btn sm" style={{ flex: 1 }}>Отмена</button>
            {secondaryBtn(onDismiss, "Свернуть")}
          </div>
        </div>
      )}
      {status === "cancelled" && (
        <div key="cancelled" className="cs-pop-fade" style={{ textAlign: "center", padding: "10px 4px" }}>
          <div style={{ width: 34, height: 34, margin: "0 auto 10px", borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(180deg,rgba(226,92,92,.18),rgba(226,92,92,.06))", border: "1px solid rgba(226,92,92,.35)", color: ERR, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), 0 2px 6px rgba(0,0,0,.4)" }}>
            <IconStop size={16} />
          </div>
          <div style={{ font: `600 13px ${FONT_SANS}`, color: TEXT }}>Прервано</div>
          <div style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, marginTop: 5 }}>Остановлено на этапе «{STAGES[phase]}»</div>
          <button onClick={onDismiss} className="cs-btn sm" style={{ marginTop: 12 }}>Назад</button>
        </div>
      )}
      {status === "done" && (
        <div key="done" className="cs-pop-fade">
          {(() => {
            const tldr = splitTldr(text).tldr;
            const teasers = extractTeasers(text);
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, font: `600 11px ${FONT_SANS}`, color: OK }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%", background: "linear-gradient(180deg,#3ec47f,#2ea66f 50%,#1f7d52)", border: "1px solid #145c39", display: "grid", placeItems: "center", color: "#0d2418", fontWeight: 700, fontSize: 10, flex: "0 0 auto", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.4)" }}>✓</span>
                  Конспект готов
                </div>
                {tldr && (
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Главная мысль</span>
                    <div className="md-body" style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }} dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr) }} />
                  </div>
                )}
                {teasers.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Основные тезисы</span>
                    <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {teasers.slice(0, 3).map((t, i) => (
                        <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }}>
                          <span style={{ flex: "0 0 auto", marginTop: 3, background: CELL2, color: MUT, font: `500 9px ${FONT_MONO}`, padding: "1px 4px", borderRadius: 3, lineHeight: 1.4 }}>{i + 1}</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            );
          })()}
          <div style={{ display: "flex", gap: 7 }}>
            <button onClick={onRead} className="cs-btn filled sm" style={{ flex: 1 }}><IconRead size={13} /> Читать полностью</button>
            <button onClick={onOpenYt} title="Открыть на YouTube" aria-label="Открыть на YouTube" className="cs-mini" style={{ width: 34, height: 34, color: YT_BLUE, flex: "0 0 auto" }}>
              <IconYoutube size={15} />
            </button>
          </div>
          <button onClick={onDismiss} className="cs-btn sm block" style={{ marginTop: 7 }}>Свернуть</button>
        </div>
      )}
      {status === "error" && errorReason === "not_configured" && (
        <div style={{ textAlign: "center", padding: "10px 4px" }}>
          <div style={{ font: `500 12px/1.5 ${FONT_SANS}`, color: SEC, marginBottom: 12 }}>{error}</div>
          <button onClick={onDismiss} className="cs-btn sm">Назад</button>
        </div>
      )}
      {status === "error" && errorReason !== "not_configured" && (
        <div style={{ textAlign: "center", padding: "10px 4px" }}>
          <div style={{ font: `500 12px/1.5 ${FONT_SANS}`, color: ERR, marginBottom: 12 }}>{error}</div>
          <button onClick={onDismiss} className="cs-btn sm">Назад</button>
        </div>
      )}
    </div>
  );
}

// Живой превью стрима в попапе: TL;DR + начало тела появляются по мере генерации.
function StreamPreview({ text }: { text: string }) {
  const { tldr, body } = splitTldr(text);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9, font: `600 10.5px ${FONT_SANS}`, color: AMBER }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #ffd687, #f5a623 60%, #8a5a10)", boxShadow: "0 0 7px rgba(245,166,35,.55), inset 0 1px 0 rgba(255,255,255,.4)", flex: "0 0 auto" }} />
        Конспект пишется
      </div>
      {tldr && (
        <div style={{ marginBottom: 9 }}>
          <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Главная мысль</span>
          <div className="md-body" style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }} dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr) }} />
        </div>
      )}
      {body.trim() && (
        <div className="md-body rp-body cs-pop-scroll" style={{ maxHeight: 150, overflowY: "auto", paddingRight: 4 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(body.slice(0, 800), "panel") }} />
      )}
    </div>
  );
}

// Компактный индикатор стрима в попапе: генерация идёт/готова, клик — развернуть.
export function StreamBanner({ status, title, onExpand }: { status: string; title: string | null; onExpand: () => void }) {
  const done = status === "done";
  const accent = done ? OK : AMBER;
  return (
    <button onClick={onExpand} className="cs-pop-fade" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${done ? "rgba(255,255,255,.14)" : "rgba(245,166,35,.4)"}`, background: done ? "linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))" : "linear-gradient(180deg,rgba(245,166,35,.1),rgba(245,166,35,.03))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.07), 0 2px 4px rgba(0,0,0,.4)", cursor: "pointer", textAlign: "left" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 auto", background: done ? "rgba(255,255,255,.08)" : "rgba(245,166,35,.15)", color: accent }}>
        {done ? <IconCheck size={12} /> : <Clogo size={12} busy spin />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: `600 11px ${FONT_SANS}`, color: accent }}>{done ? "Конспект готов" : "Идёт конспект"}</span>
        <span style={{ display: "block", font: `500 10.5px ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title ?? "YouTube"}</span>
      </span>
      <IconChevron size={14} style={{ transform: "rotate(-90deg)", color: MUT, flex: "0 0 auto" }} />
    </button>
  );
}

// Строка недавнего конспекта + inline-раскрытие мини-превью. Конспект уже в кэше.
function PopRec(props: { d: Digest; open: boolean; onToggle: () => void; onRead: () => void }) {
  const { d, open, onToggle, onRead } = props;
  return (
    <>
      <div className="pop-rec" style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 11.5px ${FONT_SANS}`, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {d.title ?? "Без названия"}
          </div>
          <div style={{ font: `400 10px ${FONT_MONO}`, color: MUT, marginTop: 2 }}>
            {fmtDate(d.ts)} · {fmtDuration(d.durationSec ?? undefined)}
          </div>
        </div>
        <button
          onClick={onToggle}
          title="Читать"
          aria-label="Читать"
          className={`cs-mini${open ? " is-active" : ""}`}
          style={{ color: open ? AMBER : SEC }}
        >
          <IconRead size={13} />
        </button>
      </div>
      <div className={`cs-pop-expand${open ? " open" : ""}`}><PopExpand markdown={d.markdown} onRead={onRead} /></div>
    </>
  );
}

// Развёрнутое мини-превью недавнего конспекта: TL;DR + тезисы + «Читать полностью».
function PopExpand(props: { markdown: string; onRead: () => void }) {
  const { markdown, onRead } = props;
  const { tldr } = splitTldr(markdown);
  const teasers = extractTeasers(markdown);
  return (
    <>
      {tldr && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Главная мысль</span>
          <div className="md-body" style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }} dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr) }} />
        </div>
      )}
      {teasers.length > 0 && (
        <div>
          <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Основные тезисы</span>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {teasers.slice(0, 3).map((t, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }}>
                <span style={{ flex: "0 0 auto", marginTop: 3, background: CELL2, color: MUT, font: `500 9px ${FONT_MONO}`, padding: "1px 4px", borderRadius: 3, lineHeight: 1.4 }}>{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <button onClick={onRead} className="cs-btn filled sm block" style={{ marginTop: 12 }}><IconRead size={13} /> Читать полностью</button>
    </>
  );
}

function PopHead({ onGear, onRefresh }: { onGear: () => void; onRefresh: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderBottom: `1px solid ${BORDER}`, background: SURFACE_HEAD, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)" }}>
      <Clogo size={18} />
      <span style={{ font: `700 13px ${FONT_SANS}`, color: TEXT }}>Conspect</span>
      <span style={{ flex: 1 }} />
      <button onClick={onRefresh} title="Обновить" aria-label="Обновить" className="cs-mini" style={{ color: MUT }}>
        <IconRefresh size={15} />
      </button>
      <button onClick={onGear} title="Личный кабинет" aria-label="Личный кабинет" className="cs-mini" style={{ color: MUT }}>
        <IconUser size={15} />
      </button>
    </div>
  );
}

function Divider({ label, mt = 11, mb = 8, mx = 13 }: { label: string; mt?: number; mb?: number; mx?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: `${mt}px ${mx}px ${mb}px` }}>
      <span style={{ height: 1, flex: 1, background: LINE }} />
      <span style={{ font: `600 10px ${FONT_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>{label}</span>
      <span style={{ height: 1, flex: 1, background: LINE }} />
    </div>
  );
}

// Очередь ожидающих видео в попапе: компактные строки с drag-and-drop перестановкой,
// кнопкой «открыть на YouTube» и удалением (через подтверждение в родителе).
function QueueList({ queue, onRemove, reorderQueue }: { queue: QueueItem[]; onRemove: (item: QueueItem) => void; reorderQueue: (from: number, to: number) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // FLIP: плавный съезд строк при перестановке. Анимируем только при смене порядка id,
  // не при сдвиге всего блока (см. тот же guard в кабинете).
  const pos = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-qid]"));
    const nextIds = rows.map((r) => r.dataset.qid ?? "");
    const prevIds = [...pos.current.keys()];
    const sameOrder = nextIds.length === prevIds.length && nextIds.every((id, i) => id === prevIds[i]);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const r of rows) {
      const id = r.dataset.qid ?? "";
      const top = r.getBoundingClientRect().top;
      const prev = pos.current.get(id);
      if (!reduced && !sameOrder && prev !== undefined && Math.abs(prev - top) > 0.5) {
        r.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(.22,.61,.36,1)" });
      }
      next.set(id, top);
    }
    pos.current = next;
  }, [queue]);
  return (
    <div style={{ marginTop: 12 }}>
      <Divider label={`Очередь (${queue.length})`} mt={0} mb={8} mx={0} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {queue.map((item, i) => {
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
                display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 7,
                border: `1px solid ${dragging ? "rgba(245,166,35,.5)" : LINE2}`,
                background: dragging ? "rgba(245,166,35,.08)" : over ? "rgba(245,166,35,.05)" : CELL,
                boxShadow: over ? "inset 0 2px 0 rgba(245,166,35,.8)" : "none",
                cursor: dragging ? "grabbing" : "grab",
                opacity: dragging ? 0.45 : 1,
                transform: dragging ? "scale(.98)" : "none",
                transition: `background .15s ${EASE}, border-color .15s ${EASE}, box-shadow .15s ${EASE}, opacity .15s ${EASE}, transform .15s ${EASE}`,
              }}
            >
              <span style={{ flex: "0 0 auto", color: MUT, display: "inline-flex" }}><IconGrip size={13} /></span>
              <span style={{ width: 16, height: 16, borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 auto", font: `600 9px ${FONT_MONO}`, color: AMBER, background: "rgba(245,166,35,.14)", border: "1px solid rgba(245,166,35,.35)" }}>{i + 1}</span>
              <span title={item.title ?? item.url} style={{ flex: 1, minWidth: 0, font: `500 11px ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title ?? videoIdOf(item.url)}</span>
              <button onClick={() => void chrome.tabs.create({ url: item.url })} title="Открыть на YouTube" aria-label="Открыть на YouTube" className="cs-mini" style={{ color: YT_BLUE, flex: "0 0 auto" }}><IconYoutube size={13} /></button>
              <button onClick={() => onRemove(item)} title="Убрать из очереди" aria-label="Убрать из очереди" className="cs-mini" style={{ color: MUT, flex: "0 0 auto" }}><IconClose size={12} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

injectFonts();
createRoot(document.getElementById("root")!).render(<Popup />);
