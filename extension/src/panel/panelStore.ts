// External panel store + subscription to the global stream (streamStore in the SW). Lives
// outside React: the content script calls openPanel(url), the panel and button subscribe via
// useSyncExternalStore. The stream is held by the SW — the panel is only a subscriber: closing the
// window (closePanel) merely unsubscribes the port; the expensive generation plays out in the background,
// the window can be brought back by a repeat click (#11/#16). Text appears live: SSE → SW → broadcast.
//
// Render throttle (120ms) — inside scheduleTextFlush, not on every delta: the SW sends
// a snapshot per token; we accumulate text in pendingText and put it into state on a timer.
// 120, not 60: markdown is re-parsed on every flush; fewer flushes → less CPU on a long
// stream; visually identical. The loading→streaming transition and meta changes — immediate.
import { REASON_TEXT, type Meta } from "./format";

type PanelStatus =
  | "closed"
  | "loading"
  | "streaming"
  | "done"
  | "error"
  | "cancelled"
  | "queued";

export type PanelState = {
  status: PanelStatus;
  url: string;
  text: string;
  meta: Meta;
  progress: { i: number; n: number } | null;
  startedAt: number | null; // epoch-ms of the start — the loading timer counts from it
  queuePos: number | null; // queue position (from 1) when status === "queued"
  errorText: string;
};

const initial: PanelState = {
  status: "closed",
  url: "",
  text: "",
  meta: {},
  progress: null,
  startedAt: null,
  queuePos: null,
  errorText: "",
};

let state: PanelState = initial;
const listeners = new Set<() => void>();

// Immutable replacement → between changes getPanelState returns a stable
// reference (useSyncExternalStore correctly skips the re-render).
export function getPanelState(): PanelState {
  return state;
}
export function subscribePanel(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function set(patch: Partial<PanelState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// --- stream subscription ---
let port: chrome.runtime.Port | null = null;
// portId — the port epoch. disconnectPort increments it → the old port's listeners
// (onMessage/onDisconnect) see myId !== portId and stay silent. Without it, the old
// port's onDisconnect would fire after rotate/close and hang a spurious "stream_closed"
// error on the fresh session. The current port (SW died) — myId === portId → error.
let portId = 0;
// The current panel's url: a filter against foreign stream snapshots. On rotate to another url the SW
// first sends a snapshot of the still-running old stream — we skip it and wait for ours.
let openedUrl = "";
// The last url opened via openPanel. NOT cleared by closePanel: the content script
// uses it to auto-open the panel when returning to a video after SPA navigation (#8).
let lastUrl = "";
let lastAt = 0;
export function getLastOpen(): { url: string; at: number } {
  return { url: lastUrl, at: lastAt };
}
// Whether we have already seen a non-idle stream state. idle before that — the starting snapshot (before
// the SW managed to set loading), we ignore it and keep optimistic loading. idle after —
// "stopped without text" → close the panel.
let seen = false;
// Latest text from the SW; goes into state.text on a timer (throttle), not per token.
let pendingText = "";
let renderTimer: ReturnType<typeof setTimeout> | undefined;

function flushNow(): void {
  if (renderTimer !== undefined) {
    clearTimeout(renderTimer);
    renderTimer = undefined;
  }
}
function scheduleTextFlush(): void {
  if (renderTimer !== undefined) return;
  renderTimer = setTimeout(() => {
    renderTimer = undefined;
    set({ text: pendingText });
  }, 120);
}

function disconnectPort(): void {
  stopKeepalive();
  if (!port) return;
  portId++; // invalidate this port's listeners
  const p = port;
  port = null;
  try {
    p.disconnect();
  } catch {
    /* port already dead */
  }
}

// Keepalive: the SW dies if idle >~30s. Between meta and the first delta the LLM "thinks" over
// a large transcript for tens of seconds, only ping frames are sent — they do not reset
// the SW idle timer, the worker dies and the port breaks. A message over the port every 20s is an event
// for the SW, it resets the timer and keeps the stream alive until the first delta.
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
function startKeepalive(): void {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    try { port?.postMessage({ type: "keepalive" }); } catch { stopKeepalive(); }
  }, 20000);
}
function stopKeepalive(): void {
  if (keepaliveTimer !== undefined) { clearInterval(keepaliveTimer); keepaliveTimer = undefined; }
}

// SW → panel: {type:"state", ...StreamState}. Mapped into PanelState.
type StreamSnap = {
  status: string;
  url: string;
  text: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  progress: { i: number; n: number } | null;
  startedAt: number | null;
  queue: { url: string; title?: string }[] | undefined;
  error: string;
  errorReason: string;
};

function applyState(s: StreamSnap): void {
  if (s.status === "idle") {
    // Before the first real state — the starting snapshot, ignored (optimistic loading).
    // After — the stream ended without text (stopped/collapsed) → close the panel.
    if (seen) closePanel();
    return;
  }
  // A foreign stream snapshot on rotate — skip, wait for ours. But if our url is in
  // the queue, it is not "foreign" but "waiting for its turn" (#12): show the position.
  if (s.url && openedUrl && s.url !== openedUrl) {
    const pos = (s.queue ?? []).findIndex((q) => q.url === openedUrl);
    if (pos >= 0) {
      seen = true;
      set({ status: "queued", url: openedUrl, queuePos: pos + 1 });
    }
    return;
  }

  seen = true;
  pendingText = s.text ?? "";
  const meta: Meta = {
    title: s.title ?? undefined,
    channel: s.channel ?? undefined,
    durationSec: s.durationSec ?? undefined,
    lang: s.lang ?? undefined,
  };

  if (s.status === "error") {
    flushNow();
    set({ status: "error", url: s.url, text: pendingText, meta, progress: null, queuePos: null, errorText: s.error || REASON_TEXT.exception });
    return;
  }
  if (s.status === "done") {
    flushNow();
    set({ status: "done", url: s.url, text: pendingText, meta, progress: null, queuePos: null });
    return;
  }
  if (s.status === "cancelled") {
    // Stopped without text: show "Interrupted". The SW resets to idle in ~2s →
    // the panel closes itself. startedAt is kept — the timer counts out in the interrupt card.
    flushNow();
    set({ status: "cancelled", url: s.url, text: "", meta, progress: null, startedAt: s.startedAt ?? null, queuePos: null, errorText: "" });
    return;
  }
  // loading / streaming. Only text grows (streaming→streaming) — throttle, no extra
  // re-render; the loading→streaming transition (first delta) and meta changes — immediate.
  if (!(s.status === "streaming" && state.status === "streaming")) {
    set({ status: s.status as PanelStatus, url: s.url, meta, progress: s.progress ?? null, startedAt: s.startedAt ?? null, queuePos: null });
  }
  scheduleTextFlush();
}

export function openPanel(url: string): void {
  // Same video and the panel already shows a running/finished digest — the click is redundant:
  // no restart, no flicker. A video change or a retry after an error goes through. The stream's own
  // idempotency (a repeat start of the same url) additionally guards in streamStore.
  if (state.status !== "closed" && state.status !== "error" && state.url === url) return;
  lastUrl = url;
  lastAt = Date.now();
  openedUrl = url;
  seen = false;
  pendingText = "";
  flushNow();
  set({ status: "loading", url, text: "", meta: {}, progress: null, startedAt: null, queuePos: null, errorText: "" });
  disconnectPort(); // the old subscriber leaves; the SW stream continues
  const my = ++portId;
  // connect throws "Extension context invalidated" synchronously if the tab holds an
  // orphaned content script after an extension update. Without try/catch, a click on the
  // trigger/feed button would throw an unhandled exception. An honest error instead.
  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connect({ name: "digest-stream" });
  } catch {
    set({ status: "error", errorText: "Расширение обновилось. Обновите страницу YouTube." });
    return;
  }
  port = p;
  startKeepalive();
  p.onMessage.addListener((m: StreamSnap) => {
    if (my !== portId) return;
    if (m && (m as { type?: string }).type === "state") applyState(m);
  });
  // The SW died / got evicted and the port broke by itself (not via disconnectPort) — the stream is lost.
  // No "eternal streaming": an honest error. my !== portId filters out the old port.
  p.onDisconnect.addListener(() => {
    if (my !== portId) return;
    port = null;
    stopKeepalive();
    if (state.status === "loading" || state.status === "streaming") {
      set({ status: "error", errorText: REASON_TEXT.stream_closed });
    }
  });
  try {
    p.postMessage({ type: "start", url });
  } catch {
    /* the context became invalid between connect and post — onDisconnect will raise the error */
  }
}

export function closePanel(): void {
  // Only unsubscribe: the SW stream plays out in the background. The panel can be restored with openPanel.
  flushNow();
  pendingText = "";
  seen = false;
  openedUrl = "";
  disconnectPort();
  set({ status: "closed", url: "", text: "", meta: {}, queuePos: null, errorText: "" });
}

// Stop the generation on user demand. The credit was charged by the backend at request
// start — an early stop does not refund it. The SW finalizes with the accumulated text
// (done — we show the digest) or, if no text arrived, goes idle → the panel
// closes in applyState. We hold the port until the final state.
export function stopStream(): void {
  try {
    port?.postMessage({ type: "stop" });
  } catch {
    /* the port is gone already — the SW finalizes without us */
  }
}

export function isBusy(): boolean {
  return state.status === "loading" || state.status === "streaming";
}
