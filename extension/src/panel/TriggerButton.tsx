// Кнопка-запуск «Конспект»: круглый металлический рубильник (skeuo .cs-metal) с
// серебряной монограммой-C. Крепится в строке действий под плеером (content.tsx),
// рядом с «Сохранить»/«Поделиться». По клику открывает панель и (если нужно)
// запускает стрим.
//
// Подписана и на panelStore (открытие/закрытие панели), и на глобальный стрим (useStream):
// даже когда панель закрыта, кнопка крутится, пока генерация этого ролика идёт в фоне, и
// снова даёт открыть окно по клику (#16 — «вижу, что генерация пошла, и могу открыть»).
//
// Native <button>, не antd — для точного контроля круглой формы. Металл (radial-gradient
// серебро + inset bevel + drop-shadow + :hover/:active) берём из skeuoCss (.cs-metal),
// Clogo той же природы, что и диск. Текста нет: компактно, не конкурирует с кнопками
// YouTube; назначение — через title и aria-label (бренд «Conspect», латиницей).
import { useSyncExternalStore } from "react";
import { isBusy, openPanel, subscribePanel } from "./panelStore";
import { useStream } from "../useStream";
import { focusRingCss, reducedMotionCss, skeuoCss, spinKeyframes } from "../theme/conspectTheme";
import { Clogo } from "../theme/icons";
import { videoId } from "./format";

export function TriggerButton() {
  useSyncExternalStore(subscribePanel, () => (isBusy() ? 1 : 0));
  const { s: stream } = useStream();
  const panelBusy = isBusy();
  // Стрим этого ролика может идти и при закрытой панели (панель — лишь подписчик).
  const thisVideo = stream.status !== "idle" && !!stream.url && videoId(stream.url) === videoId(location.href);
  const busy = panelBusy || (thisVideo && (stream.status === "loading" || stream.status === "streaming"));
  return (
    <>
      <style>{skeuoCss}{spinKeyframes}{focusRingCss}{reducedMotionCss}</style>
      <button
        className="cs-metal"
        onClick={() => openPanel(location.href)}
        title={busy ? "Conspect…" : "Conspect"}
        aria-label="Conspect"
        style={{
          width: 36,
          height: 36,
          padding: 0,
          opacity: busy ? 0.85 : 1,
        }}
      >
        <Clogo size={22} busy={busy} spin={busy} />
      </button>
    </>
  );
}
