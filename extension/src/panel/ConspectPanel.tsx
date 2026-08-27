// Плавающая панель конспекта (§07 read-panel). Живёт в shadow-host (fixed-оверлей,
// pointer-events:none), сама карточка — absolute и включает клики у себя.
//
// Состояния: loading (стадии+таймер+факт), streaming/done (TL;DR «Главная мысль» +
// тело-маркдаун), error (блок без тех-деталей).
// Markdown — marked+DOMPurify в Shadow DOM, таймкоды кликабельны (seek видео).
//
// Шапка: Clogo + title + Stop (при стриме) + скопировать/скачать (после готовности) +
// свернуть + закрыть. Действия в шапке, отдельного футера нет.
// Свернуть/развернуть — плавный морфинг контейнера (framer-motion) + crossfade круг↔панель.
import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { renderMarkdown } from "../lib/markdown";
import { closePanel, getPanelState, stopStream, subscribePanel } from "./panelStore";
import { LoadingCard, STAGES } from "../screens/cards";
import { downloadBlob, fileName, fmtDuration, hashUrl, savedMinutes, splitTldr, wrapFrontmatter, type Meta } from "./format";
import {
  BG,
  CARD,
  EASE,
  FONT_MONO,
  FONT_SANS,
  LINE,
  LINE2,
  METAL_RADIAL,
  OK,
  SEC,
  TEXT,
  ERR,
  BORDER,
  SURFACE,
  SURFACE_HEAD,
  SHADOW_BADGE,
  TXT_SHADOW,
  AMBER,
  skeuoCss,
  scanKeyframes,
  mdBodyCss,
  panelBodyCss,
  focusRingCss,
  reducedMotionCss,
} from "../theme/conspectTheme";
import { Clogo, IconCheck, IconChevron, IconClose, IconCopy, IconDownload, IconError, IconRead, IconStop } from "../theme/icons";

const EASE_ARR: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export function ConspectPanel() {
  const s = useSyncExternalStore(subscribePanel, getPanelState);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Пользователь прервал автоскролл — перестаём тащить вниз, иначе читать стримящийся
  // конспект невозможно: текст убегает каждую итерацию. Сбрасывается на новом конспекте.
  const userInteracted = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = s.url || location.href;
  // Уважаем prefers-reduced-motion: морфинг/crossfade и CSS-анимации гасятся.
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (s.status === "loading") userInteracted.current = false;
  }, [s.status, s.url]);

  // Автоскролл вниз во время стрима, пока пользователь не вмешался.
  useEffect(() => {
    if (userInteracted.current) return;
    if (s.status === "streaming" || s.status === "loading") {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [s.text, s.status]);

  // Ушёл от низа — отключаем автоскролл; вернулся к низу — снова цепляем.
  function onBodyUserScroll(el: HTMLDivElement): void {
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    userInteracted.current = !atBottom;
  }

  if (s.status === "closed") return null;

  const meta = s.meta;
  const dur = fmtDuration(meta.durationSec);
  const sv = savedMinutes(meta.durationSec);
  const done = s.status === "done";
  const busy = s.status === "streaming" || s.status === "loading";
  // Фаза стрима — эвристика по событиям SSE: meta → «Анализирую», первый delta → «Собираю».
  // meta.durationSec != null (а не truthiness): само событие meta — сигнал фазы 1,
  // даже если duration ещё 0/неизвестен; иначе falsy-ноль оставил бы стадию на «Скачиваю субтитры».
  const phase: 0 | 1 | 2 = s.text.trim() ? 2 : meta.title || meta.durationSec != null ? 1 : 0;
  const { tldr, body } = splitTldr(s.text);
  const showBody = s.status === "streaming" || s.status === "done";
  const card = s.status === "loading";

  async function copy(): Promise<boolean> {
    const text = wrapFrontmatter({ meta: s.meta, conspectus: s.text }, url);
    // Возвращаем промис, чтобы кнопка копирования в шапке показывала «✓ Скопировано» только после
    // реальной записи, а не синхронно до settle (иначе при реджекте буфера
    // пользователь видел бы успех при провале).
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // HTTP-контекст / нет фокуса — clipboard API может быть недоступен.
      // Фолбэк на устаревший, но рабочий execCommand поверх основного документа.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

  // Открыть полную читалку (read.html) для готового конспекта. Полный markdown уже в
  // кэше под hashUrl(url), read.html подтянет его из chrome.storage без сети.
  // Контент-скрипт не имеет chrome.tabs — открытие вкладки идёт через SW (sendMessage).
  function openRead(): void {
    if (!s.url) return;
    void chrome.runtime.sendMessage({ type: "openRead", urlHash: hashUrl(s.url), url: s.url });
  }

  // C2: клик по таймкоду в теле → seek YouTube-плеера (document общий, видео — на странице).
  function onBodyClick(e: React.MouseEvent<HTMLDivElement>): void {
    const el = (e.target as HTMLElement).closest?.(".md-ts") as HTMLElement | null;
    if (!el) return;
    const t = Number(el.dataset.t);
    if (!Number.isFinite(t) || t < 0) return;
    const v = (document.querySelector("#movie_player video") ?? document.querySelector("video.html5-main-video") ?? document.querySelector("video")) as HTMLVideoElement | null;
    if (v) v.currentTime = t;
    e.preventDefault();
    e.stopPropagation();
  }

  // Морфинг контейнер: collapse → круг 48px, expand → панель 380. Анимируем width,
  // borderRadius, фон/рамку/тень. height НЕ анимируем — иначе при стриме (тело растёт
  // каждый тик) панель дрожала бы; смену высоты маскирует crossfade содержимого.
  const boxAnim = collapsed
    ? { width: 48, borderRadius: 24, backgroundColor: "rgba(26,26,26,0)", borderColor: "rgba(58,58,58,0)", boxShadow: "0 0 0 0 rgba(0,0,0,0)" }
    : { width: 380, borderRadius: 14, backgroundColor: CARD, borderColor: BORDER, boxShadow: `inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.55)` };

  return (
    <>
      <style>{skeuoCss}</style>
      <style>{mdBodyCss}</style>
      <style>{panelBodyCss}</style>
      <style>{focusRingCss}</style>
      <style>{`${scanKeyframes}@keyframes cs-fadein{from{opacity:0}to{opacity:1}}@keyframes cs-panel-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@keyframes cpulse{0%,100%{box-shadow:0 0 0 4px rgba(245,166,35,.10),0 0 18px rgba(245,166,35,.28)}50%{box-shadow:0 0 0 6px rgba(245,166,35,.16),0 0 28px rgba(245,166,35,.45)}}@keyframes ccancel{0%,100%{box-shadow:0 0 0 4px rgba(226,92,92,.12),0 0 18px rgba(226,92,92,.3)}50%{box-shadow:0 0 0 6px rgba(226,92,92,.18),0 0 28px rgba(226,92,92,.5)}}`}</style>
      <style>{`
.rp-head{display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid ${BORDER};background:${SURFACE_HEAD};box-shadow:inset 0 1px 0 rgba(255,255,255,.08);}
.rp-title{flex:1;min-width:0;font:700 12px/1.2 ${FONT_SANS};color:${TEXT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:${TXT_SHADOW};}
.rp-meta{padding:7px 13px 8px;font:600 10.5px ${FONT_SANS};color:${SEC};letter-spacing:.04em;border-bottom:1px solid ${LINE};background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.05));}
.rp-tex{background-image:${SURFACE},repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 2px,transparent 2px 4px),radial-gradient(120% 90% at 50% 42%,rgba(12,12,14,0) 26%,rgba(12,12,14,.86) 100%);}
.rp-meta .sv{color:${OK};}
.rp-tldr{background:none;border:none;border-radius:0;padding:0;margin-bottom:14px;}
.rp-tag{display:block;width:fit-content;font:700 9px ${FONT_MONO};color:${BG};letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px;padding:3px 8px;border-radius:6px;border:1px solid ${BG};background:${METAL_RADIAL};text-shadow:0 1px rgba(255,255,255,.5);box-shadow:${SHADOW_BADGE};}
.rp-tldr-txt{font:500 11.5px/1.5 ${FONT_SANS};color:${SEC};text-align:left;}
.rp-tldr-txt p{margin:0;}
.cs-mini.stop svg rect{fill:currentColor;}
/* × на свёрнутом круге: скрыть панель целиком, не разворачивая. Виден при ховере
   круга (opacity), тач не нужен — desktop-расширение. focus-visible — с клавиатуры. */
.cp-x{position:absolute;top:-6px;right:-6px;width:17px;height:17px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(226,92,92,.6);background:#191113;color:#e25c5c;cursor:pointer;opacity:0;transition:opacity .15s ${EASE},background .15s ${EASE},color .15s ${EASE};}
.cs-metal:hover .cp-x,.cp-x:focus-visible{opacity:1;}
.cp-x:hover{background:#e25c5c;color:#16090b;border-color:#e25c5c;}
.cs-metal.busy{animation:cpulse 1.8s ${EASE} infinite;}
.rp-scroll::-webkit-scrollbar{width:6px;}
.rp-scroll::-webkit-scrollbar-thumb{background:${LINE2};border-radius:3px;}
.rp-scroll::-webkit-scrollbar-track{background:transparent;}
`}</style>
      <style>{reducedMotionCss}</style>
      <motion.div
        initial={false}
        animate={boxAnim}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_ARR }}
        style={{
          position: "absolute",
          top: 64,
          right: 16,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 96px)",
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
          overflow: collapsed ? "visible" : "hidden",
          border: "1px solid transparent",
          transformOrigin: "top right",
          animation: `cs-panel-in .25s ${EASE}`,
          ...(collapsed ? { width: 48, height: 48 } : {}),
        }}
      >
        {/* развёрнутое содержимое — всегда в потоке (даёт высоту); при сворачивании fade-out.
            pointerEvents off, чтобы клики шли в круг-C, пока панель невидима. */}
        <div className="rp-tex" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, opacity: collapsed ? 0 : 1, transition: `opacity ${reduceMotion ? "0s" : ".2s"} ${EASE}`, pointerEvents: collapsed ? "none" : undefined }}>
          {/* шапка: Clogo · title видео · свернуть · закрыть */}
          <div className="rp-head">
            <span style={{ display: "inline-flex", alignItems: "center" }}><Clogo size={16} /></span>
            <span className="rp-title">{s.status === "queued" ? "В очереди" : meta.title || "Конспект"}</span>
            {busy && (
              <button className="cs-mini stop" title="Остановить" aria-label="Остановить" onClick={() => stopStream()}>
                <IconStop size={16} />
              </button>
            )}
            {done && (
              <button
                className="cs-mini"
                title={copied ? "Скопировано" : "Скопировать"}
                aria-label={copied ? "Скопировано" : "Скопировать"}
                onClick={async () => { if (await copy()) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }}
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </button>
            )}
            {done && (
              <button className="cs-mini" title="Скачать .md" aria-label="Скачать .md" onClick={() => downloadMd(s.text, s.meta, url)}>
                <IconDownload size={16} />
              </button>
            )}
            <button
              className="cs-mini"
              title="Свернуть"
              aria-label="Свернуть"
              onClick={() => setCollapsed(true)}
            >
              <IconChevron size={17} />
            </button>
            <button
              className="cs-mini"
              title="Закрыть"
              aria-label="Закрыть"
              onClick={closePanel}
            >
              <IconClose size={16} />
            </button>
          </div>

          {/* мета: видео MM:SS · сохранено N мин */}
          {!card && (meta.durationSec || sv > 0) && (
            <div className="rp-meta">
              {meta.durationSec ? <>видео {dur}</> : null}
              {sv > 0 && <> · сохранено <span className="sv">{sv} мин</span></>}
            </div>
          )}

          {/* тело. card-состояния (loading/connect/paywall) — отцентрированы в панели. */}
          <div
            ref={bodyRef}
            className="rp-scroll"
            onClick={onBodyClick}
            onScroll={(e) => onBodyUserScroll(e.currentTarget)}
            style={
              s.status === "loading"
                // загрузка §06 встроена в панеру (embedded): встык, без отступов и
                // центрирования — рамку/скругление даёт панель, сканлайн идёт край-в-край.
                ? { position: "relative", padding: 0, overflow: "hidden", overflowWrap: "anywhere", flex: 1, display: "block", minHeight: 340 }
                : card
                ? { position: "relative", padding: "14px 16px", overflowY: "auto", overflowWrap: "anywhere", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }
                : { position: "relative", padding: "14px 16px", overflowY: "auto", overflowWrap: "anywhere", flex: 1, maxHeight: 330 }
            }
          >
            {s.status === "loading" && <LoadingCard phase={phase} startedAt={s.startedAt} progress={s.progress} />}
            {s.status === "queued" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "24px 6px" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(180deg,rgba(245,166,35,.18),rgba(245,166,35,.06))", border: "1px solid rgba(245,166,35,.35)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px 4px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.4)", color: AMBER }}>
                  <Clogo size={18} />
                </div>
                <div style={{ font: `600 13px ${FONT_SANS}`, color: TEXT }}>В очереди</div>
                <div style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, maxWidth: 280 }}>
                  Позиция {s.queuePos ?? ""}. Конспект соберётся, когда освободится место.
                </div>
              </div>
            )}
            {s.status === "cancelled" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "24px 6px" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(180deg,rgba(226,92,92,.18),rgba(226,92,92,.06))", border: "1px solid rgba(226,92,92,.35)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px 4px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.4)", color: ERR, animation: `ccancel .9s ${EASE} infinite` }}>
                  <IconStop size={18} />
                </div>
                <div style={{ font: `600 13px ${FONT_SANS}`, color: TEXT }}>Прервано</div>
                <div style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, maxWidth: 280 }}>
                  Остановлено на этапе «{STAGES[phase]}»
                </div>
              </div>
            )}
            {showBody && (
              <div style={{ animation: `cs-fadein .35s ${EASE}`, width: "100%" }}>
                {tldr && (
                  <div className="rp-tldr">
                    <span className="rp-tag">Главная мысль</span>
                    <div className="rp-tldr-txt" dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr) }} />
                  </div>
                )}
                <div
                  className="md-body rp-body"
                  dangerouslySetInnerHTML={{
                    __html:
                      renderMarkdown(body, "panel") +
                      (s.status === "streaming" ? '<span class="md-caret"></span>' : ""),
                  }}
                />
              </div>
            )}
            {s.status === "error" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "24px 6px" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(180deg,rgba(226,92,92,.18),rgba(226,92,92,.06))", border: "1px solid rgba(226,92,92,.35)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px 4px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.4)", color: ERR }}>
                  <IconError size={18} />
                </div>
                <div style={{ font: `500 13px ${FONT_SANS}`, color: TEXT, maxWidth: 300 }}>{s.errorText}</div>
              </div>
            )}
          </div>

          {/* После готовности — «Читать полностью» открывает полную читалку read.html
              (оглавление + прогресс чтения). Полный конспект уже в кэше. */}
          {done && (
            <div style={{ padding: "10px 13px 12px", borderTop: `1px solid ${LINE}` }}>
              <button onClick={openRead} className="cs-btn filled block"><IconRead size={13} /> Читать полностью</button>
            </div>
          )}
        </div>

        {/* круг-C: свёрнутая панель (§05). Overlay по центру; fade-in при сворачивании. */}
        <div
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: collapsed ? 1 : 0, transition: `opacity ${reduceMotion ? "0s" : ".2s"} ${EASE}`, pointerEvents: collapsed ? "auto" : "none" }}
        >
          <div
            className={`cs-metal${busy ? " busy" : ""}`}
            style={{ width: 48, height: 48, position: "relative" }}
            role="button"
            tabIndex={0}
            aria-label="Развернуть панель"
            title="Развернуть"
            onClick={() => setCollapsed(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed(false); } }}
          >
            <span style={{ display: "inline-flex", transform: "translateX(3.8%)" }}>
              <Clogo size={26} busy={busy} />
            </span>
            {/* Скрыть свёрнутую панель: раньше круг умел только разворачивать —
                закрыть его с экрана без разворота было нельзя. stopPropagation,
                иначе клик всплывёт к onClick круга и сначала развернёт панель.
                Стрим не останавливаем: по дизайну SW доиграет его в фон и закэширует. */}
            <button
              className="cp-x"
              title="Скрыть"
              aria-label="Скрыть панель"
              onClick={(e) => { e.stopPropagation(); closePanel(); }}
            >
              <IconClose size={9} />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function downloadMd(text: string, meta: Meta, url: string): void {
  downloadBlob(fileName(meta.title), wrapFrontmatter({ meta, conspectus: text }, url));
}
