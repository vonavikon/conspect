// Service worker (MV3). Cross-origin fetch к self-host серверу только тут — content-script
// fetch блокируется. Content/options/popup общаются с ним через chrome.runtime.sendMessage.
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

// Первичная настройка подключения: агент кладёт config.json (baseUrl + sharedToken) в
// dist/ при установке. Расширение читает его при каждом старте service worker и пишет
// в chrome.storage. Настроек сервера в ЛК нет — подключение задаётся только этим файлом.
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
    // config.json нет или он битый — настройки остаются как есть.
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
          // Контент-скрипт (панель на YouTube) не имеет доступа к chrome.tabs — открытие
          // читалки read.html в новой вкладке делаем здесь, в SW.
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
  port.onMessage.addListener((msg: { type?: string; url?: string; fromIndex?: number; toIndex?: number }) => {
    if (msg?.type === "start" && msg.url) void startStream(msg.url);
    else if (msg?.type === "stop") stopStream();
    else if (msg?.type === "removeFromQueue" && msg.url) removeFromQueue(msg.url);
    else if (msg?.type === "reorderQueue") reorderQueue(msg.fromIndex ?? -1, msg.toIndex ?? -1);
    // keepalive — no-op: само прибытие сообщения сбрасывает idle-таймер SW.
    else if (msg?.type === "keepalive") { /* держит SW живым */ }
  });
  port.onDisconnect.addListener(() => unsubscribe(port));
});

// Читаем config.json при каждом старте SW — свежая установка или обновлённый токен
// подхватываются без ручного ввода настроек.
void seedFromConfigJson();
