// Floating digest panel (§07 read-panel). Lives in a shadow-host (fixed overlay,
// pointer-events:none); the card itself is absolute and re-enables clicks.
//
// States: loading (stages + timer + fact), streaming/done (the "Main idea" TL;DR +
// a markdown body), error (a block without tech details).
// Markdown — marked+DOMPurify in Shadow DOM; timecodes are clickable (video seek).
//
// Header: Clogo + title + Stop (while streaming) + copy/download (once done) +
// collapse + close. Actions live in the header; there is no separate footer.
// Collapse/expand — smooth container morphing (framer-motion) + circle↔panel crossfade.
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
  // The user interrupted autoscroll — stop dragging down, otherwise the streaming digest
  // is impossible to read: the text runs away every tick. Reset on a new digest.
  const userInteracted = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = s.url || location.href;
  // Respect prefers-reduced-motion: morphing/crossfade and CSS animations are disabled.
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (s.status === "loading") userInteracted.current = false;
  }, [s.status, s.url]);

  // Autoscroll down during the stream until the user intervenes.
  useEffect(() => {
    if (userInteracted.current) return;
    if (s.status === "streaming" || s.status === "loading") {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [s.text, s.status]);

  // Left the bottom — disable autoscroll; back at the bottom — re-engage.
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
  // Stream phase — a heuristic over SSE events: meta → "Analyzing", first delta → "Assembling".
  // meta.durationSec != null (not truthiness): the meta event itself is the phase-1 signal,
  // even if duration is still 0/unknown; otherwise a falsy zero would keep the stage at "Downloading subtitles".
  const phase: 0 | 1 | 2 = s.text.trim() ? 2 : meta.title || meta.durationSec != null ? 1 : 0;
  const { tldr, body } = splitTldr(s.text);
  const showBody = s.status === "streaming" || s.status === "done";
  const card = s.status === "loading";

  async function copy(): Promise<boolean> {
    const text = wrapFrontmatter({ meta: s.meta, conspectus: s.text }, url);
    // Return a promise so the header copy button shows "✓ Copied" only after the actual
    // write, not synchronously before settle (otherwise, if the clipboard rejects,
    // the user would see success on failure).
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // HTTP context / no focus — the clipboard API may be unavailable.
      // Fall back to the deprecated but working execCommand over the main document.
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

  // Open the full reader (read.html) for the finished digest. The full markdown is already
  // in the cache under hashUrl(url); read.html will pull it from chrome.storage without the network.
  // The content script has no chrome.tabs — opening a tab goes through the SW (sendMessage).
  function openRead(): void {
    if (!s.url) return;
    void chrome.runtime.sendMessage({ type: "openRead", urlHash: hashUrl(s.url), url: s.url });
  }

  // C2: a timecode click in the body → seek the YouTube player (shared document; the video is on the page).
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

  // Morphing container: collapse → 48px circle, expand → 380 panel. We animate width,
  // borderRadius, background/border/shadow. height is NOT animated — otherwise during streaming (the body
  // grows every tick) the panel would jitter; the content crossfade masks the height change.
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
        {/* expanded content — always in flow (gives height); on collapse, fade-out.
            pointerEvents off, so clicks reach the C circle while the panel is invisible. */}
        <div className="rp-tex" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, opacity: collapsed ? 0 : 1, transition: `opacity ${reduceMotion ? "0s" : ".2s"} ${EASE}`, pointerEvents: collapsed ? "none" : undefined }}>
          {/* header: Clogo · video title · collapse · close */}
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

          {/* meta: video MM:SS · saved N min */}
          {!card && (meta.durationSec || sv > 0) && (
            <div className="rp-meta">
              {meta.durationSec ? <>видео {dur}</> : null}
              {sv > 0 && <> · сохранено <span className="sv">{sv} мин</span></>}
            </div>
          )}

          {/* body. card states (loading/connect/paywall) — centered in the panel. */}
          <div
            ref={bodyRef}
            className="rp-scroll"
            onClick={onBodyClick}
            onScroll={(e) => onBodyUserScroll(e.currentTarget)}
            style={
              s.status === "loading"
                // the §06 loader is embedded in the panel: flush, no padding or
                // centering — the panel provides the frame/rounding, the scanline runs edge to edge.
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

          {/* Once done — "Read in full" opens the full reader read.html
              (outline + reading progress). The full digest is already in the cache. */}
          {done && (
            <div style={{ padding: "10px 13px 12px", borderTop: `1px solid ${LINE}` }}>
              <button onClick={openRead} className="cs-btn filled block"><IconRead size={13} /> Читать полностью</button>
            </div>
          )}
        </div>

        {/* the C circle: the collapsed panel (§05). Overlay centered; fade-in on collapse. */}
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
            {/* Hide the collapsed panel: before, the circle could only expand —
                there was no way to remove it from the screen without expanding. stopPropagation,
                otherwise the click bubbles to the circle's onClick and first expands the panel.
                The stream is not stopped: by design the SW plays it out in the background and caches it. */}
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
