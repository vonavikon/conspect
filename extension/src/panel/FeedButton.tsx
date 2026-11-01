// The "Conspect" launch button on feed/search/related cards (entry point C1). An overlay
// on the preview's top-right corner: a round metal badge (skeuo .cs-metal) with the
// C monogram, no text. On click it opens the shared overlay panel and starts the
// stream of the same URL (panelStore.openPanel). stopPropagation — so clicking the button
// does not open the video itself.
//
// busy/done are computed from the videoId of the current panel state: a feed has many cards;
// only the one whose video is being processed should spin (not all at once).
// done, besides the live stream, also comes from the local digest cache — a video
// processed earlier (even in a previous browser session) is immediately green.
// States: default/busy — silver .cs-metal, busy spins C on top, done — a green
// skeuo disc (CANON .stage.done .ico) covers the silver.
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
  // The digest cache is persistent (chrome.storage.local) — the green "done" must
  // survive a browser/SW restart, not only live in the current stream's state.
  // We read once per url (feed cards are recycled, but a card's url is stable).
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let alive = true;
    getDigest(hashUrl(url))
      .then((d) => { if (alive) setCached(!!d && !!d.markdown.trim()); })
      .catch(() => { /* cache unavailable — simply no indication */ });
    return () => { alive = false; };
  }, [url]);
  const done = (mine && st.status === "done") || cached;

  return (
    <>
      <style>{skeuoCss}{spinKeyframes}{focusRingCss}{reducedMotionCss}</style>
      <button
        className="cs-metal"
        // YouTube navigates the card via a document delegate: a click anywhere on the preview
        // (including our button) goes to /watch, even if the button sits outside an <a>.
        // pointerdown is the earliest interception: we kill it inside the shadow root,
        // before it reaches light DOM, so YT's document delegates never see it.
        // We do NOT preventDefault: without the default pointerdown the browser does not produce
        // a click, and click is our working panel-open handler.
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        // mousedown doubles the suppression for YT's mouse delegates (they listen to mousedown,
        // not pointerdown). preventDefault here does not break the button's click.
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
          // done — a green skeuo disc (CANON .stage.done .ico) covers the silver .cs-metal.
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
