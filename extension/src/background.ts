// Service worker (MV3). Cross-origin fetch к self-host серверу только тут — content-script
// fetch блокируется. Content/options/popup общаются с ним через chrome.runtime.sendMessage.
import { loadSettings, saveSettings, listDigests, getDigest, clearDigests, deleteDigest } from "./lib/store.js";
import { subscribe, unsubscribe, startStream, stopStream } from "./streamStore.js";

type Msg =
  | { type: "status" }
  | { type: "saveSettings"; baseUrl: string; sharedToken: string }
  | { type: "health" }
  | { type: "listDigests" }
  | { type: "getDigest"; urlHash: string }
  | { type: "clearDigests" }
  | { type: "deleteDigest"; urlHash: string };

type Reply = Record<string, unknown>;

function normBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// GET /health с коротким таймаутом — «проверка соединения» в настройках.
async function health(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: ac.signal });
    return { ok: res.ok };
  } catch {
    return { ok: false, error: "unreachable" };
  } finally {
    clearTimeout(t);
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, send: (r: Reply) => void) => {
  // Принимаем только сообщения из своего расширения (см. sender.id).
  if (sender.id !== chrome.runtime.id) return;
  void (async () => {
    try {
      switch (msg.type) {
        case "status": {
          const st = await loadSettings();
          send({ ok: true, configured: !!(st.baseUrl && st.sharedToken), baseUrl: st.baseUrl ?? "" });
          return;
        }
        case "saveSettings": {
          const baseUrl = normBase(msg.baseUrl);
          await saveSettings({ baseUrl: baseUrl || undefined, sharedToken: msg.sharedToken.trim() || undefined });
          send({ ok: true, configured: !!(baseUrl && msg.sharedToken.trim()) });
          return;
        }
        case "health": {
          const st = await loadSettings();
          if (!st.baseUrl) { send({ ok: false, error: "no_baseurl" }); return; }
          send(await health(st.baseUrl));
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
          send({ ok: true });
          return;
        }
        case "deleteDigest": {
          await deleteDigest(msg.urlHash);
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
  return true; // ответим асинхронно
});

// Стриминг /digest/stream — подписочная модель (streamStore). Любая поверхность
// (панель на YouTube, попап) открывает порт "digest-stream": SW сразу шлёт снапшот
// текущего стрима, дальше транслирует каждое изменение. Команды подписчика —
// {type:"start",url} / {type:"stop"}. Закрытие окна = отписка порта, НЕ остановка стрима:
// генерация доигрывает в фоне, окно можно вернуть повторным кликом.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "digest-stream") return;
  if (port.sender?.id && port.sender.id !== chrome.runtime.id) return;
  subscribe(port);
  port.onMessage.addListener((msg: { type?: string; url?: string }) => {
    if (msg?.type === "start" && msg.url) void startStream(msg.url);
    else if (msg?.type === "stop") stopStream();
  });
  port.onDisconnect.addListener(() => unsubscribe(port));
});
