// Global digest-stream state in the service worker + queue (#12). Lives OUTSIDE
// any window binding: one active stream, other urls wait in the queue,
// many subscribers (panel on YouTube, popup, dashboard, trigger button). Before, the stream was
// held by a single port: close the panel/popup → port.onDisconnect → AbortController.abort() →
// the expensive pipeline died, partial text lost (#11/#16). Now a subscriber that leaves
// without an explicit stop merely unsubscribes — the stream plays out to done, the result stays in the SW.
//
// N=1 + queue: there is always exactly one active stream. start(url) on another url appends it to the
// queue (no duplicates). done/error/stop of the active one advances the queue — the next url
// starts by itself. Closing a window does not remove a task from the queue: it finishes in the
// background, the result goes to the cache. A pool with N>1 can later be done by replacing advanceQueue (take per slot, not one).
//
// Protocol over the "digest-stream" port:
//   subscriber → SW:  {type:"start", url} | {type:"stop"} | {type:"keepalive"}
//   SW → subscriber:  {type:"state", ...StreamState}   (full snapshot on every change
//                    and immediately on connect; queue — a snapshot of waiting urls, in order)
import { getDigest, loadSettings, putDigest } from "./lib/store.js";
import { playDoneSound } from "./audio";
import { hashUrl, REASON_TEXT } from "./panel/format";

// Client version the backend writes to its log — by it we can see that the user
// reloaded the extension with the current keepalive.
const CLIENT_VERSION = "v3-queue";

export type StreamStatus = "idle" | "loading" | "streaming" | "done" | "error" | "cancelled";

// Queue item: url + (optionally) title. The title is resolved via oEmbed while the
// video waits in the queue — so the dashboard shows the full name instead of a hash.
// startedAt — the enqueue moment: when the queue reaches the video, the digest timer
// keeps counting from it instead of restarting (total time includes the wait).
export type QueueItem = { url: string; title?: string; startedAt: number };

type StreamState = {
  status: StreamStatus;
  url: string;
  text: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  phase: 0 | 1 | 2; // 0 before meta, 1 meta, 2 deltas flowing — stage heuristic for loading §06
  progress: { i: number; n: number } | null; // chunking: "part i/N" while the map phase runs
  startedAt: number | null; // epoch-ms of when work on the url began (click or enqueue)
  queue: QueueItem[]; // waiting urls (in add order) — snapshot for subscribers
  error: string; // human-readable text (REASON_TEXT); empty for non-error
  errorReason: string; // raw reason (not_authed/no_credits/…) — for mapping to cards
};

const IDLE: StreamState = {
  status: "idle", url: "", text: "", title: null, channel: null,
  durationSec: null, lang: null, phase: 0, progress: null, startedAt: null, queue: [], error: "", errorReason: "",
};

let state: StreamState = { ...IDLE };
const subs = new Set<chrome.runtime.Port>();
// The single source of the queue. state.queue is always a snapshot of this array (set puts
// it over any patch); the queue itself lives here, at module level, and is NOT persisted.
let queue: QueueItem[] = [];
let ctrl: AbortController | null = null;

// Title cache by url (oEmbed) — to avoid hitting YouTube repeatedly for one video.
const titleCache = new Map<string, string>();

async function resolveTitle(url: string): Promise<string | null> {
  const hit = titleCache.get(url);
  if (hit !== undefined) return hit || null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string };
    const t = j.title?.trim() || null;
    if (t) titleCache.set(url, t);
    return t;
  } catch {
    return null;
  }
}

// The SW is ephemeral: module-level state survives window closure but NOT the SW
// terminator (~30s idle). Only a finished result survives: done/error is written to
// chrome.storage.session and restored when the SW wakes up again — otherwise a repeat
// click on an already-done url would see IDLE and restart the stream (the backend would charge the credit twice).
// Live loading/streaming is not persisted: an active SSE-fetch keeps the SW alive, and after a break
// without done the result is lost anyway — restore only makes sense for terminal states.
const STATE_KEY = "conspect_stream_v1";
let restored = false;
const restoreP = (async () => {
  try {
    const v = await chrome.storage.session.get(STATE_KEY);
    const saved = v[STATE_KEY] as StreamState | undefined;
    // queue is NOT restored: it lives in memory and does not survive the SW terminator. A snapshot
    // from saved would be stale (a different SW run); we keep a clean [].
    if (saved && (saved.status === "done" || saved.status === "error")) state = { ...saved, queue: [] };
  } catch {
    /* session storage unavailable — work as before, from memory */
  }
  restored = true;
})();
function persist(): void {
  try {
    if (state.status === "done" || state.status === "error") {
      void chrome.storage.session.set({ [STATE_KEY]: state });
    } else if (state.status === "idle") {
      void chrome.storage.session.remove(STATE_KEY);
    }
  } catch {
    /* */
  }
}

function safePost(port: chrome.runtime.Port, msg: unknown): void {
  try { port.postMessage(msg); } catch { /* port already closed — subscriber gone */ }
}

function set(patch: Partial<StreamState>): void {
  // queue is always mixed in: no patch may "lose" the current queue.
  state = { ...state, ...patch, queue: [...queue] };
  broadcast();
  persist();
}
function broadcast(): void {
  const msg = { type: "state", ...state };
  for (const p of subs) safePost(p, msg);
}

// New subscriber: immediately gets a snapshot of the current stream (even idle — to know
// there is no generation). Unsubscribing does NOT stop the stream — it survived the window closing.
// If the SW just woke up and the session restore has not finished — wait for it, otherwise
// the subscriber would get IDLE over a restored done and restart the stream.
export function subscribe(port: chrome.runtime.Port): void {
  subs.add(port);
  const send = (): void => safePost(port, { type: "state", ...state });
  if (restored) send();
  else void restoreP.then(send);
}
export function unsubscribe(port: chrome.runtime.Port): void {
  subs.delete(port);
}

function isLive(s: StreamState): boolean {
  return s.status === "loading" || s.status === "streaming" || s.status === "done";
}

// Save the finished digest to the local cache (self-host: the server stores nothing). meta fields
// come from the current state — by done time they have already arrived via the meta event.
async function cacheDigest(url: string, markdown: string): Promise<void> {
  if (!markdown.trim()) return;
  try {
    await putDigest({
      urlHash: hashUrl(url),
      url,
      ts: Math.floor(Date.now() / 1000),
      title: state.title,
      channel: state.channel,
      durationSec: state.durationSec,
      lang: state.lang,
      markdown,
    });
  } catch { /* quota/unavailable — the cache is not critical */ }
}

// Single "finished" finale: terminal state + cache + notification sound. Used in all
// branches where the digest actually completed (SSE done, masked error, stream break
// with text). stopStream plays no sound — the stop was initiated by the user.
function markDone(url: string, markdown: string): void {
  set({ text: markdown, status: "done" });
  void cacheDigest(url, markdown);
  void playDoneSound();
}

export async function startStream(url: string, since?: number): Promise<void> {
  // Wait for the session restore: if the SW just woke up, state is still IDLE while session
  // holds a done for this url — without waiting, the guard fails and the stream restarts.
  if (!restored) await restoreP;
  // Same url and the stream is live (running or already done) — do not restart: repeat clicks
  // merely re-subscribe.
  if (state.url === url && isLive(state)) return;
  // The active stream is busy with another url — enqueue (no duplicates, no limit). N=1:
  // no parallel generation, the url waits its turn. When the active one is done/error/stop —
  // advanceQueue starts the next and passes through the enqueue moment (timer without reset).
  if (state.status === "loading" || state.status === "streaming") {
    if (!queue.some((q) => q.url === url)) {
      queue.push({ url, startedAt: since ?? Date.now() });
      set({}); // refresh the queue snapshot in state + broadcast
      // Resolve the title asynchronously: the dashboard queue will show the name instead of a hash.
      void resolveTitle(url).then((t) => {
        const item = queue.find((q) => q.url === url);
        if (item && t && !item.title) { item.title = t; set({}); }
      });
    }
    return;
  }
  // Cache: a digest for this url is already built and sits in local storage — do not run
  // the pipeline or burn LLM credit again; return the ready markdown immediately. Checked
  // here, AFTER the queue branch: if the active stream is busy with another url, the global
  // state is single — switching it to "done" over a live stream would race with delta.
  // In the queue the url waits for a free slot and returns here with no active stream.
  // Cache reset — deleting the digest in the dashboard (deleteDigest): it will regenerate.
  // No sound and no re-caching, hence a direct set, not markDone.
  const cached = await getDigest(hashUrl(url));
  if (cached && cached.markdown.trim()) {
    set({
      ...IDLE, status: "done", url, text: cached.markdown,
      title: cached.title ?? null, channel: cached.channel ?? null,
      durationSec: cached.durationSec ?? null, lang: cached.lang ?? null,
    });
    return;
  }
  await runStream(url, since);
}

// Advance the queue: take the next url and start it. One call — one start;
// invoked in runStream's finally (done/error/abort of the active one freed the slot).
// The enqueue startedAt is passed through: the digest timer counts total time including the wait.
function advanceQueue(): void {
  const next = queue.shift();
  if (next) void startStream(next.url, next.startedAt);
}

// Remove a url from the waiting queue (the active stream is untouched — it is stopped
// via stopStream). The dashboard shows the queue and allows removing an extra url.
export function removeFromQueue(url: string): void {
  const i = queue.findIndex((q) => q.url === url);
  if (i < 0) return;
  queue.splice(i, 1);
  set({}); // refresh the queue snapshot + broadcast
}

// Reorder a url in the queue (drag-and-drop in the dashboard): fromIndex → toIndex.
export function reorderQueue(fromIndex: number, toIndex: number): void {
  if (fromIndex < 0 || fromIndex >= queue.length) return;
  if (toIndex < 0 || toIndex >= queue.length) return;
  if (fromIndex === toIndex) return;
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  set({});
}

// The digest cache is cleared in the dashboard (deleteDigest/clearDigests in background.ts). If
// the deleted url was in terminal done, reset the state to idle — otherwise a repeat
// startStream(url) hits the "same url and stream live" guard and silently does not restart
// generation (the cache is empty, the user sees a stale done with no text). Active
  // loading/streaming is untouched: the stream finishes and re-caches on its own.
export function invalidateDone(urlHash: string): void {
  if (!state.url || state.status !== "done") return;
  if (hashUrl(state.url) === urlHash) set({ ...IDLE });
}
export function invalidateAllDone(): void {
  if (state.status === "done") set({ ...IDLE });
}

async function runStream(url: string, since?: number): Promise<void> {
  if (ctrl) try { ctrl.abort(); } catch { /* already aborted */ }
  ctrl = new AbortController();
  // Local copy of the controller: fixes a race where stopStream/url change reassigns
  // the module-level ctrl while the old catch wrote an error over the new loading state.
  const myCtrl = ctrl;
  // startedAt — from the enqueue (since), not from the generation start: a video that waited
  // an hour in the queue must not "zero out" the timer. Direct start — the click moment.
  set({ ...IDLE, status: "loading", url, startedAt: since ?? Date.now() });

  const st = await loadSettings();
  const baseUrl = st.baseUrl;
  if (!baseUrl || !st.sharedToken) {
    set({ status: "error", errorReason: "not_configured", error: REASON_TEXT.not_configured });
    advanceQueue();
    return;
  }

  let accText = "";
  let phase: 0 | 1 | 2 = 0;
  // Keepalive: the browser evicts an MV3 service worker idle for more than ~30s. Between
  // meta and the first delta a large transcript keeps the LLM "thinking" for tens of seconds —
  // an active SSE-fetch does not always reset the idle timer, the SW dies, the panel port breaks
  // and the panel shows "Connection lost" although the backend keeps generating.
  // A trivial chrome.runtime call every 20s resets the timer and keeps the SW alive.
  const keepalive = setInterval(() => {
    // Documented keepalive (Chrome 114+): SENDING a message over a long-lived port
    // resets the SW idle timer. The panel ignores "ping" (not a state), but the very fact of sending
    // keeps the worker alive during a long LLM "thinking" phase. getPlatformInfo — second line of defense.
    void chrome.runtime.getPlatformInfo().catch(() => {});
    for (const p of subs) safePost(p, { type: "ping" });
    // Diagnostics: /ping every 20s. Breaks in these backend-log lines show whether
    // the SW lived and at which second it went silent.
    void fetch(baseUrl.replace(/\/$/, "") + "/ping").catch(() => {});
  }, 20000);
  try {
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/digest/stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${st.sharedToken}` },
      body: JSON.stringify({ url, client: CLIENT_VERSION }),
      signal: myCtrl.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let body: any = null;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      const reason = (body?.reason as string | undefined) ?? "http_error";
      set({ status: "error", errorReason: reason, error: REASON_TEXT[reason] ?? REASON_TEXT.exception });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
        // CRLF→LF: proxies/gateways re-pack frames with \r\n, and the "\n\n"
        // separator stops matching — data piles up unparsed.
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const evt = parseSSE(buf.slice(0, sep));
        buf = buf.slice(sep + 2);
        if (!evt || evt.type === "ping") continue;
        if (evt.type === "meta") {
          phase = 1;
          set({
            title: (evt.title as string | null) ?? null,
            channel: (evt.channel as string | null) ?? null,
            durationSec: (evt.durationSec as number | null) ?? null,
            lang: (evt.lang as string | null) ?? null,
            phase,
          });
        } else if (evt.type === "progress") {
          // Chunking: the map phase runs before the first merge delta. Show "part i/N".
          set({ progress: { i: Number(evt.i) || 0, n: Number(evt.n) || 0 } });
        } else if (evt.type === "delta") {
          accText += (evt.delta as string) ?? "";
          phase = 2;
          set({ text: accText, status: "streaming", phase, progress: null });
        } else if (evt.type === "done") {
          markDone(url, accText);
          return;
        } else if (evt.type === "error") {
          // #3: the backend sometimes sends error at the very end when all text has arrived
          // ("reaches the end and crashes"). If anything accumulated, show the finished
          // digest, masking the server's finalization failure.
          const reason = (evt.reason as string | undefined) ?? "exception";
          if (accText.trim()) markDone(url, accText);
          else set({ status: "error", errorReason: reason, error: REASON_TEXT[reason] ?? REASON_TEXT.exception });
          return;
        }
      }
    }
    // Stream closed without an explicit done/error (network/gateway cut without [DONE]).
    if (accText.trim()) markDone(url, accText);
    else set({ status: "error", errorReason: "stream_closed", error: REASON_TEXT.stream_closed });
  } catch (e) {
    // Regular stop (stopStream/url change) — abort, silently. myCtrl, not ctrl:
    // the module-level ctrl may already point at the next stream's controller.
    if (myCtrl.signal.aborted) return;
    set({ status: "error", errorReason: "exception", error: REASON_TEXT.exception });
  } finally {
    clearInterval(keepalive);
    advanceQueue();
  }
}

// Explicit user stop. The credit was charged by the backend at request start —
// the accumulated text counts as finished (as panelStore.stopStream did before).
// The queue is untouched: aborting the active one wakes advanceQueue in runStream's finally,
// the next url starts by itself.
export function stopStream(): void {
  if (ctrl) { try { ctrl.abort(); } catch { /* already */ } ctrl = null; }
  if (state.status === "loading" || state.status === "streaming") {
    if (state.text.trim()) { set({ status: "done" }); void cacheDigest(state.url, state.text); }
    else {
      // No text — show "Interrupted" in the panel/popup, then auto-reset to idle
      // (the panel closes itself). startedAt is kept so the timer counts out to the end.
      set({ status: "cancelled" });
      setTimeout(() => { if (state.status === "cancelled") set({ ...IDLE }); }, 2000);
    }
  }
}

// One SSE event (several data: lines are joined) → { type: event, ...data }.
function parseSSE(raw: string): { type: string; [k: string]: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    return { type: event, ...(JSON.parse(dataLines.join("\n")) as Record<string, unknown>) };
  } catch {
    return { type: event };
  }
}
