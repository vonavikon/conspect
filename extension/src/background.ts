// Service worker (MV3). Cross-origin fetch to the self-host server happens only here —
// content-script fetch is blocked. Content/options/popup talk to it via chrome.runtime.sendMessage.
import { loadSettings, saveSettings, listDigests, getDigest, clearDigests, deleteDigest } from "./lib/store.js";
import { subscribe, unsubscribe, startStream, stopStream, removeFromQueue, reorderQueue, invalidateDone, invalidateAllDone } from "./streamStore.js";

type Msg =
  | { type: "status" }
  | { type: "listDigests" }
  | { type: "getDigest"; urlHash: string }
  | { type: "clearDigests" }
  | { type: "deleteDigest"; urlHash: string }
  | { type: "openRead"; urlHash: string; url: string };

type Reply = Record<string, unknown>;

function normBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// Initial connection setup: an agent places config.json (baseUrl + sharedToken) into
// dist/ at install time. The extension reads it on every service worker start and writes
// it to chrome.storage. There are no server settings in the dashboard — the connection is defined only by this file.
async function seedFromConfigJson(): Promise<void> {
  try {
    const res = await fetch(chrome.runtime.getURL("config.json"));
    if (!res.ok) return;
    const raw = (await res.json()) as { baseUrl?: string; sharedToken?: string };
    const baseUrl = typeof raw.baseUrl === "string" ? normBase(raw.baseUrl) : "";
    const sharedToken = typeof raw.sharedToken === "string" ? raw.sharedToken.trim() : "";
    if (!baseUrl || !sharedToken) return;
    await saveSettings({ baseUrl, sharedToken });
  } catch {
    // config.json is missing or broken — the settings stay as they are.
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, send: (r: Reply) => void) => {
  // Accept only messages from our own extension (see sender.id).
  if (sender.id !== chrome.runtime.id) return;
  void (async () => {
    try {
      switch (msg.type) {
        case "status": {
          const st = await loadSettings();
          send({ ok: true, configured: !!(st.baseUrl && st.sharedToken), baseUrl: st.baseUrl ?? "" });
          return;
        }
        case "listDigests": {
          const digests = await listDigests();
          send({ ok: true, digests });
          return;
        }
        case "getDigest": {
          const d = await getDigest(msg.urlHash);
          send({ ok: true, digest: d ?? null });
          return;
        }
        case "clearDigests": {
          await clearDigests();
          invalidateAllDone();
          send({ ok: true });
          return;
        }
        case "deleteDigest": {
          await deleteDigest(msg.urlHash);
          invalidateDone(msg.urlHash);
          send({ ok: true });
          return;
        }
        case "openRead": {
          // The content script (panel on YouTube) has no access to chrome.tabs — opening
          // the read.html reader in a new tab is done here, in the SW.
          await chrome.tabs.create({
            url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(msg.urlHash)}&u=${encodeURIComponent(msg.url)}`),
          });
          send({ ok: true });
          return;
        }
        default:
          send({ ok: false, error: "unknown_message" });
      }
    } catch (e) {
      send({ ok: false, error: "exception", message: (e as Error).message });
    }
  })();
  return true; // we will reply asynchronously
});

// Streaming /digest/stream — a subscription model (streamStore). Any surface
// (panel on YouTube, popup) opens the "digest-stream" port: the SW immediately sends a snapshot
// of the current stream, then relays every change. Subscriber commands —
// {type:"start",url} / {type:"stop"}. Closing a window = unsubscribing the port, NOT stopping the stream:
// generation plays out in the background; the window can be restored by a repeat click.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "digest-stream") return;
  if (port.sender?.id && port.sender.id !== chrome.runtime.id) return;
  subscribe(port);
  port.onMessage.addListener((msg: { type?: string; url?: string; fromIndex?: number; toIndex?: number }) => {
    if (msg?.type === "start" && msg.url) void startStream(msg.url);
    else if (msg?.type === "stop") stopStream();
    else if (msg?.type === "removeFromQueue" && msg.url) removeFromQueue(msg.url);
    else if (msg?.type === "reorderQueue") reorderQueue(msg.fromIndex ?? -1, msg.toIndex ?? -1);
    // keepalive — no-op: the very arrival of a message resets the SW idle timer.
    else if (msg?.type === "keepalive") { /* keeps the SW alive */ }
  });
  port.onDisconnect.addListener(() => unsubscribe(port));
});

// Read config.json on every SW start — a fresh install or an updated token
// get picked up without manual settings entry.
void seedFromConfigJson();
