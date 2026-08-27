// Кнопка-запуск «Conspect» на карточках в ленте/поиске/related (точка C1). Overlay
// на превью в правом-верхнем углу: круглый металлический бейдж (skeuo .cs-metal) с
// монограммой-C, без текста. По клику открывает общую оверлей-панель и запускает
// стрим того же URL (panelStore.openPanel). stopPropagation — чтобы клик по кнопке
// не открывал само видео.
//
// busy/done считаются по videoId текущего состояния панели: на ленте много карточек,
// крутиться должна только та, чей ролик сейчас обрабатывается (не все разом).
// done, кроме живого стрима, приходит из локального кэша конспектов — видео,
// обработанное раньше (даже в прошлой сессии браузера), сразу зелёное.
// Состояния: default/busy — серебряный .cs-metal, busy поверх крутит C, done — зелёный
// skeuo-диск (CANON .stage.done .ico) перекрывает серебро.
import { useEffect, useState, useSyncExternalStore } from "react";
import { getPanelState, openPanel, subscribePanel } from "./panelStore";
import { getDigest } from "../lib/store";
import { focusRingCss, reducedMotionCss, skeuoCss, spinKeyframes } from "../theme/conspectTheme";
import { Clogo } from "../theme/icons";
import { hashUrl, videoId } from "./format";

export function FeedButton({ url }: { url: string }) {
  const st = useSyncExternalStore(subscribePanel, getPanelState);
  const mine = videoId(st.url) === videoId(url);
  const busy = mine && (st.status === "loading" || st.status === "streaming");
  // Кэш конспектов персистентный (chrome.storage.local) — зелёный «готово» должен
  // переживать перезапуск браузера и SW, а не только жить в state текущего стрима.
  // Читаем один раз на url (карточки ленты рециклятся, но url на карточке стабилен).
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let alive = true;
    getDigest(hashUrl(url))
      .then((d) => { if (alive) setCached(!!d && !!d.markdown.trim()); })
      .catch(() => { /* кэш недоступен — просто без индикации */ });
    return () => { alive = false; };
  }, [url]);
  const done = (mine && st.status === "done") || cached;

  return (
    <>
      <style>{skeuoCss}{spinKeyframes}{focusRingCss}{reducedMotionCss}</style>
      <button
        className="cs-metal"
        // YouTube навигирует карточку документ-делегатом: клик в любую точку превью
        // (включая нашу кнопку) уходит в /watch, даже если кнопка лежит вне <a>.
        // pointerdown — самый ранний перехват: гасим его внутри shadow root, до
        // выхода в light DOM, чтобы YT-делегаты документа его не увидели.
        // preventDefault НЕ ставим: без дефолтного pointerdown браузер не собирает
        // click, а click — наш рабочий обработчик открытия панели.
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        // mousedown дублирует глушение для мышиных делегатов YT (слушает mousedown,
        // не pointerdown). preventDefault здесь не мешает click на кнопке.
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
        <Clogo size={18} busy={busy} spin={busy} />
      </button>
    </>
  );
}
