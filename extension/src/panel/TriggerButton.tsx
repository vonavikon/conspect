// The "Conspect" launch button: a round metal switch (skeuo .cs-metal) with a
// silver C monogram. Sits in the action row under the player (content.tsx),
// next to "Save"/"Share". On click it opens the panel and (if needed)
// starts the stream.
//
// Subscribes both to panelStore (panel open/close) and to the global stream (useStream):
// even with the panel closed, the button spins while this video's generation runs in the background, and
// a click reopens the window (#16 — "I see the generation started, and I can open it").
//
// A native <button>, not antd — for precise control of the round shape. The metal (radial-gradient
// silver + inset bevel + drop-shadow + :hover/:active) comes from skeuoCss (.cs-metal);
// the Clogo is of the same nature as the disc. No text: compact, does not compete with YouTube's
// buttons; the purpose — via title and aria-label (the "Conspect" brand, in Latin script).
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
  // This video's stream may run with the panel closed (the panel is only a subscriber).
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
