// Content script on youtube.com. Injects a "Conspect" button on watch pages
// (a round dark #0f0f0f button with a chrome-C monogram in the action row under the player, in its own
// Shadow DOM) and a floating overlay panel (also Shadow DOM). On click, a port to the
// background opens and the digest streams in — the React panel subscribes to an external store
// and updates live.
import { mountShadow } from "./panel/shadowApp";
import { TriggerButton } from "./panel/TriggerButton";
import { FeedButton } from "./panel/FeedButton";
import { ConspectPanel } from "./panel/ConspectPanel";
import { closePanel, getLastOpen, getPanelState, openPanel } from "./panel/panelStore";
import { injectFonts } from "./lib/fonts";
import { videoId } from "./panel/format";
import type { Root } from "react-dom/client";

const TRIGGER_HOST_ID = "conspect-trigger-host";
const PANEL_HOST_ID = "conspect-panel-host";

function isWatch(): boolean {
  return location.pathname === "/watch";
}

// After the extension updates/reinstalls, open YouTube tabs keep an orphaned
// content script: chrome.runtime.id becomes undefined and connect/sendMessage
// throw "Extension context invalidated" synchronously. Guard before any
// chrome.runtime call; on orphaning we stop the observer so it does not spam
// exceptions on every mutation.
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// Overlay host for the panel: fixed, covers the whole viewport, click-transparent
// (pointer-events:none) — the card itself re-enables clicks. One per page.
// We attach it to documentElement, not body: the YouTube SPA replaces body's children
// during navigation, and a direct child host could be torn down with them.
function ensurePanelHost(): void {
  if (document.getElementById(PANEL_HOST_ID)) return;
  const host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
  (document.documentElement ?? document.body).appendChild(host);
  mountShadow(host, <ConspectPanel />);
}

// The real anchor point: #subscribe-button inside the stable #owner (live metadata
// of ytd-watch-metadata / #above-the-fold). We hold on to #owner, not to
// #subscribe-button itself — the latter also appears in #meta-skeleton (a skeleton
// placeholder) that YT hides ([hidden]) once metadata loads. A button bound to the
// skeleton went display:none and stayed invisible (offsetParent=null), and the early
// return on "host already exists" prevented rebinding it. #owner has no such issue.
function ownerSubscribeButton(): HTMLElement | null {
  const owner = document.querySelector<HTMLElement>("#owner");
  if (!owner) return null;
  return (
    owner.querySelector<HTMLElement>("#subscribe-button") ??
    owner.querySelector<HTMLElement>("ytd-subscribe-button-renderer")
  );
}

let triggerRoot: Root | null = null;
function injectTrigger(): void {
  if (!isWatch()) return;
  const existing = document.getElementById(TRIGGER_HOST_ID) as HTMLElement | null;
  // Host in place, inside #owner and visible — ok. offsetParent===null catches both a node
  // hidden by an ancestor (skeleton/hidden) and display:none — we rebind in both cases.
  if (existing && existing.closest("#owner") && existing.offsetParent !== null) return;
  // Orphaned/hidden host (YT repainted the meta) — remove it together with the React root:
  // otherwise every rebind piled up an unmounted root (leak).
  if (existing) {
    existing.remove();
    if (triggerRoot) {
      triggerRoot.unmount();
      triggerRoot = null;
    }
  }
  const sub = ownerSubscribeButton();
  if (!sub || !sub.parentNode) return; // #owner not ready yet — the observer will retry
  const triggerHost = document.createElement("div");
  triggerHost.id = TRIGGER_HOST_ID;
  triggerHost.style.cssText = "display:inline-flex;align-items:center;margin-left:10px";
  // Next sibling of #subscribe-button inside #owner: the button lands on the same row,
  // right of "Subscribe", not below it.
  sub.parentNode.insertBefore(triggerHost, sub.nextSibling);
  triggerRoot = mountShadow(triggerHost, <TriggerButton />).root;
  ensurePanelHost();
  syncTriggerVisibility();
}

// On scroll YouTube collapses the metadata and in some modes makes it position:sticky/
// fixed (ytd-watch-metadata / #above-the-fold). The #subscribe-button sibling inherits
// that and "floats away" over the content, though it should leave with the block. We hide
// the button while it sits inside a sticky/fixed ancestor. Normal scrolling (block out of the viewport) takes it away on its own.
function triggerIsStuck(host: HTMLElement): boolean {
  let el: HTMLElement | null = host;
  while (el && el !== document.documentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === "sticky" || pos === "fixed") return true;
    el = el.parentElement;
  }
  return false;
}
function syncTriggerVisibility(): void {
  const host = document.getElementById(TRIGGER_HOST_ID) as HTMLElement | null;
  if (!host) return;
  host.style.visibility = triggerIsStuck(host) ? "hidden" : "";
}
let triggerVisRaf = 0;
function scheduleSyncTriggerVisibility(): void {
  if (triggerVisRaf) return;
  triggerVisRaf = requestAnimationFrame(() => {
    triggerVisRaf = 0;
    syncTriggerVisibility();
  });
}

const FEED_HOST_ID = "conspect-feed-host";

// Click shield for the feed button: a window-level CAPTURE listener intercepts the event
// before any YouTube delegates (even before document-capture) and swallows it, performing
// the action (openPanel) itself. A plain bubble-suppress on the button is not always
// reliable: in some rollouts YouTube covers the button with a hover overlay (the event
// never reaches the button) or listens in the capture phase earlier than us.
// composedPath() sees through the open Shadow DOM; the url sits in the host's data-cs-url.
// We do not preventDefault on pointerdown: per the Pointer Events spec it
// suppresses compatible mouse events; the shield needs click for its action.
function feedShield(e: Event): void {
  const path = e.composedPath();
  for (const node of path) {
    if (node instanceof HTMLElement && node.id === FEED_HOST_ID) {
      if (e.type !== "pointerdown") e.preventDefault();
      e.stopPropagation();
      if (e.type === "click") openPanel(node.dataset.csUrl ?? "");
      return;
    }
  }
}
for (const t of ["pointerdown", "mousedown", "click", "auxclick"]) {
  window.addEventListener(t, feedShield, true);
}

// Live React roots of the feed buttons. YouTube recycles/discards cards on scroll
// and SPA navigation; hosts leave the DOM, but without an explicit unmount the Shadow root
// + antd cssinjs styles + port listeners pile up → a leak. Prune removes the orphaned ones.
const feedRoots = new Map<HTMLElement, Root>();

function pruneFeedRoots(): void {
  for (const [host, root] of feedRoots) {
    if (host.isConnected) continue;
    root.unmount();
    feedRoots.delete(host);
  }
}

// Button on feed/search/related/playlist cards ("Watch later" = playlist?list=WL)
// (entry point C1): an overlay pill on the preview;
// a click starts a digest of the same URL through the shared panel. ensurePanelHost — the panel
// is needed on non-watch pages too (on watch, injectTrigger installs it). YouTube
// selectors drift — we iterate over several card types.
//
// We batch the injection (rule #6 master skill): a feed/search page has dozens of cards, and
// per-card style.setProperty + createRoot thrash layout. We slice by 20 with a yield (rAF)
// between batches so the main thread is not blocked. The inFlight flag serializes calls
// from the coalescing timer — while one pass runs, the next is skipped.
let feedInFlight = false;
async function injectFeedButtons(): Promise<void> {
  if (feedInFlight) return;
  feedInFlight = true;
  try {
    pruneFeedRoots();
    ensurePanelHost();
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model"
      ),
    );
    const BATCH = 20;
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    for (let i = 0; i < cards.length; i += BATCH) {
      for (const card of cards.slice(i, i + BATCH)) injectFeedCard(card);
      if (i + BATCH < cards.length) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (scheduler?.yield) await scheduler.yield();
      }
    }
  } finally {
    feedInFlight = false;
  }
}

// The card's thumbnail container — where the pill button goes (so it sits on the preview,
// not at the row's edge). Old layout: ytd-thumbnail (rich/video/compact/grid). New one
// (view-model in the related column on the right): yt-thumbnail-view-model. Fallbacks — the
// a#thumbnail / a[href*=watch] anchor. Nothing found — the card itself.
function thumbAnchor(card: HTMLElement): HTMLElement {
  return (
    card.querySelector<HTMLElement>("ytd-thumbnail") ??
    card.querySelector<HTMLElement>("yt-thumbnail-view-model") ??
    card.querySelector<HTMLElement>('a#thumbnail[href*="/watch"]') ??
    card.querySelector<HTMLElement>('a[href*="/watch"]') ??
    card
  );
}

// The nearest ancestor that actually serves as the containing block for a position:absolute descendant:
// it generates a box (not display:contents) and position != static. None — documentElement
// (the initial containing block). Needed for the fallback path in injectFeedCard, where the button sits on the card.
function containingBlock(el: HTMLElement): HTMLElement {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "contents") continue;
    if (cs.position !== "static") return e;
  }
  return document.documentElement;
}

// A single feed/search/related card: an overlay pill on the preview.
function injectFeedCard(card: HTMLElement): void {
  const link = card.querySelector<HTMLAnchorElement>(
    'a#thumbnail[href*="/watch"], a[href*="/watch"]'
  );
  if (!link) return;
  const url = link.href;
  if (!/[?&]v=/.test(url)) return;
  const existing = card.querySelector<HTMLElement>("#" + FEED_HOST_ID);
  // YouTube recycles compact/rich cards on scroll: one DOM node gets a
  // new a[href]. We detect the desync via data-cs-url — rebind the button to the
  // fresh URL, otherwise it stays forever on the card's first video preview.
  if (existing && existing.dataset.csUrl === url) return;
  if (existing) {
    const root = feedRoots.get(existing);
    if (root) root.unmount();
    feedRoots.delete(existing);
    existing.remove();
  }
  // We attach the button to the preview wrapper (ytd-thumbnail), not to the card: the wrapper is
  // a real box, relative + left/top 8px keep the button in the preview's top-left corner.
  // The new home layout (yt-lockup-view-model) flipped the tree: yt-thumbnail-view-model
  // sits INSIDE <a href="/watch">, and planting the button into the "wrapper" again turned out
  // to be planting it into the link — the click went to video navigation. closest("a") catches
  // both on-link and in-link planting (including the old a#thumbnail anchor): then we attach
  // the host to the link's PARENT and compute the offset from the link's rect — the parent
  // holder is wider than the link itself, and plain 8px would put the button off the preview.
  const anchor = thumbAnchor(card);
  const insideA = anchor.closest("a");
  const useThumb = anchor !== card && anchor.tagName !== "A" && !insideA;
  const hostParent = useThumb ? anchor : ((insideA?.parentElement as HTMLElement | null) ?? card);

  const host = document.createElement("div");
  host.id = FEED_HOST_ID;
  host.dataset.csUrl = url;
  let left = 8;
  let top = 8;
  if (!useThumb) {
    if (getComputedStyle(hostParent).position === "static") {
      hostParent.style.setProperty("position", "relative", "important");
    }
    // Offset from hostParent's containing block: hostParent may be display:contents
    // (containers of the new layout) and not accept relative — then the block is
    // the nearest box up the tree. We measure from hostParent, not from host:
    // host is not in the tree yet (appendChild below), its ancestors are empty, and
    // containingBlock would return documentElement — the button slid off on the home page.
    const cb = containingBlock(hostParent);
    const cbRect = cb.getBoundingClientRect();
    const thumbRect = (insideA ?? anchor).getBoundingClientRect();
    left = Math.max(0, Math.round(thumbRect.left - cbRect.left + 8));
    top = Math.max(0, Math.round(thumbRect.top - cbRect.top + 8));
  }
  host.style.cssText =
    `position:absolute!important;left:${left}px!important;top:${top}px!important;z-index:100!important;pointer-events:auto;display:block;width:32px;height:32px;`;
  if (getComputedStyle(hostParent).position === "static") {
    hostParent.style.setProperty("position", "relative", "important");
  }
  // Scope the stacking context on the parent, otherwise the button's z-index escapes to the page level
  // and it draws over YouTube's fixed header (masthead z-index 2020) on scroll.
  hostParent.style.setProperty("isolation", "isolate", "important");
  hostParent.appendChild(host);
  const { root } = mountShadow(host, <FeedButton url={url} />);
  feedRoots.set(host, root);
}

// ?cs-auto=1 on a watch page — auto-open the panel and start the digest. The popup sets it
// when starting from a pasted link (outside YouTube): we open the watch page with this
// flag and the content script auto-starts. Once per load.
let autoApplied = false;
function readAuto(): void {
  if (autoApplied) return;
  if (new URLSearchParams(location.search).get("cs-auto") !== "1") return;
  if (!isWatch()) return;
  autoApplied = true;
  ensurePanelHost();
  openPanel(location.href);
}

// The popup sends {type:"cs-open-panel"} from the active watch tab (the "Make digest" CTA).
// We open the panel on the current video. The URL comes from the tab's location — the popup
// already verified that the active tab is a /watch?v= page.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isExtensionContextValid()) return;
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "cs-open-panel" && isWatch()) {
    ensurePanelHost();
    openPanel(location.href);
  }
});

// (Re)inject on SPA navigation + until the button lands (the DOM may still be loading).
function arm(): void {
  // Orphaning after an extension update: every further chrome.runtime call throws.
  // We stop the observer so arm() does not fire on every mutation of the orphaned tab.
  if (!isExtensionContextValid()) {
    obs.disconnect();
    return;
  }
  injectFonts();
  injectTrigger();
  void injectFeedButtons();
  readAuto();
}
// A panel opened from the feed (entry point C1) lives in a position:fixed overlay and is
// not tied to the page. When navigating to ANOTHER video's watch page, we close it so a
// foreign digest does not hang over the new video. Same video (feed → its watch page) —
// keep it. Navigation to a non-watch page (feed/search/home) — keep the panel too:
// otherwise auto-close would kill a panel opened right in the feed (yt-navigate-finish
// sometimes fires without a video change).
function onNavigate(): void {
  const st = getPanelState();
  const curId = /[?&]v=/.test(location.href) ? videoId(location.href) : null;
  if (st.status !== "closed" && curId && curId !== videoId(st.url)) {
    closePanel();
  }
  // Auto-reopen (#8): we returned to a video whose digest was opened recently, and the
  // panel got closed by navigation. The SW stream has finished/is finishing — openPanel returns
  // a snapshot (streaming/done). Limited to 10 minutes so the panel does not pop up by itself hours later.
  const last = getLastOpen();
  if (st.status === "closed" && last.url && curId && curId === videoId(last.url) && Date.now() - last.at < 10 * 60 * 1000) {
    openPanel(last.url);
  }
  arm();
}
document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("load", arm);
// Watch the trigger button "sticking": if YouTube made its ancestor sticky/fixed
// (metadata collapse on scroll), hide the button; back in normal flow — show it.
window.addEventListener("scroll", scheduleSyncTriggerVisibility, { passive: true });
window.addEventListener("resize", scheduleSyncTriggerVisibility);
// YouTube mutates the DOM hundreds of times per second (player, tooltips, like counters).
// We coalesce all injections into one 150ms timer — otherwise querySelectorAll over the cards
// and the trigger's offsetParent check thrash layout on every mutation. arm() short-circuits:
// the trigger returns immediately once placed correctly; feed — once hosts exist on all cards.
let armTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleArm(): void {
  if (armTimer !== undefined) clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armTimer = undefined;
    arm();
  }, 150);
}
// E3: YouTube mutates the DOM hundreds of times per second, but we only care about structural
// changes (elements added/removed — feed cards, #owner appearing).
// Text mutations (counter updates, tooltips) are childList with text nodes;
// we filter them out, otherwise the coalescing timer fires on every text update.
function onMutate(records: MutationRecord[]): void {
  for (const r of records) {
    if (r.type !== "childList") continue;
    for (const n of r.addedNodes) if (n.nodeType === 1) { scheduleArm(); return; }
    for (const n of r.removedNodes) if (n.nodeType === 1) { scheduleArm(); return; }
  }
}
const obs = new MutationObserver(onMutate);
obs.observe(document.documentElement, { childList: true, subtree: true });
arm();
