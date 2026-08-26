// Кнопка-запуск «Conspect» на карточках в ленте/поиске/related (точка C1). Overlay
// на превью в правом-верхнем углу: круглый металлический бейдж (skeuo .cs-metal) с
// монограммой-C, без текста. По клику открывает общую оверлей-панель и запускает
// стрим того же URL (panelStore.openPanel). stopPropagation — чтобы клик по кнопке
// не открывал само видео.
//
// busy/done считаются по videoId текущего состояния панели: на ленте много карточек,
// крутиться должна только та, чей ролик сейчас обрабатывается (не все разом).
// Состояния: default/busy — серебряный .cs-metal, busy поверх крутит C, done — зелёный
// skeuo-диск (CANON .stage.done .ico) перекрывает серебро.
import { useSyncExternalStore } from "react";
import { getPanelState, openPanel, subscribePanel } from "./panelStore";
import { dchkCss, focusRingCss, reducedMotionCss, skeuoCss, spinKeyframes, swapCss } from "../theme/conspectTheme";
import { Clogo } from "../theme/icons";
import { videoId } from "./format";

export function FeedButton({ url }: { url: string }) {
  const st = useSyncExternalStore(subscribePanel, getPanelState);
  const mine = videoId(st.url) === videoId(url);
  const busy = mine && (st.status === "loading" || st.status === "streaming");
  const done = mine && st.status === "done";

  return (
    <>
      <style>{skeuoCss}{swapCss}{dchkCss}{spinKeyframes}{focusRingCss}{reducedMotionCss}</style>
      <button
        className="cs-metal"
        // YouTube начинает SPA-навигацию по карточке на pointerdown/mousedown,
        // раньше click. preventDefault+stopPropagation на самом click её уже не
        // гасит → видео открывается вместе с панелью. На главной (home) навигация
        // стартует ещё раньше — на pointerdown (hover-to-play превью), поэтому
        // глушим и его. preventDefault на pointerdown не зовём: он отменил бы
        // последующий mousedown/click, и наш onClick (openPanel) не сработал бы.
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openPanel(url);
        }}
        title={busy ? "Conspect…" : done ? "Конспект готов" : "Conspect"}
        aria-label="Conspect"
        style={{
          width: 32,
          height: 32,
          padding: 0,
          cursor: busy ? "progress" : "pointer",
          opacity: busy ? 0.92 : 1,
          // done — зелёный skeuo-диск (CANON .stage.done .ico), перекрывает серебро .cs-metal.
          ...(done
            ? {
                background: "linear-gradient(180deg,#3ec47f,#2ea66f 50%,#1f7d52)",
                borderColor: "#145c39",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.4)",
              }
            : null),
        }}
      >
        {/* done: Clogo уходит в blur (icon swap №09), чек прорисовывается stroke-draw
            (success check №10). Класс .cs-dchk навешивается только при done — иначе
            его forwards-анимация opacity перекрыла бы скрытие :last-child в покое. */}
        <span className={done ? "cs-swap done" : "cs-swap"} style={{ width: 18, height: 18 }}>
          <Clogo size={18} busy={busy} spin={busy} />
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={done ? "cs-dchk" : undefined} style={{ color: "#0d2418" }} aria-hidden="true">
            <path d="M4 8.6l2.7 2.7 5.3-5.6" pathLength="100" />
          </svg>
        </span>
      </button>
    </>
  );
}
