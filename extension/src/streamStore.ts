// Глобальное состояние стрима конспекта в service worker. Живёт ВНЕ привязки к
// конкретному окну: один стрим — много подписчиков (панель на YouTube, попап, кабинет,
// кнопка-триггер). Раньше стрим держал один порт: закрыл панель/попап → port.onDisconnect
// → AbortController.abort() → дорогой пайплайн умирал, частичный текст терялся, а
// пользователь не мог вернуть окно генерации (#11/#16). Теперь подписчик, ушедший без
// явной остановки, только отпишется — стрим доиграет до done, результат останется в SW.
//
// Протокол по порту "digest-stream":
//   подписчик → SW:  {type:"start", url} | {type:"stop"} | {type:"keepalive"}
//   SW → подписчик:  {type:"state", ...StreamState}   (полный снапшот на каждое изменение
//                    и сразу при подключении — новый подписчик видит текущий статус)
// Стрим стартует по {type:"start", url}; тот же url при loading/streaming/done — no-op
// (повторные клики не плодят параллельные fetch). Другой url на фоне — старый abort-ится.
import { loadSettings, putDigest } from "./lib/store.js";
import { hashUrl, REASON_TEXT } from "./panel/format";

export type StreamStatus = "idle" | "loading" | "streaming" | "done" | "error";

type StreamState = {
  status: StreamStatus;
  url: string;
  text: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  phase: 0 | 1 | 2; // 0 до meta, 1 meta, 2 пошёл delta — эвристика стадий loading §06
  error: string; // человекочитаемый текст (REASON_TEXT); пусто для не-error
  errorReason: string; // сырой reason (not_authed/no_credits/…) — для маппинга в карточки
};

const IDLE: StreamState = {
  status: "idle", url: "", text: "", title: null, channel: null,
  durationSec: null, lang: null, phase: 0, error: "", errorReason: "",
};

let state: StreamState = { ...IDLE };
const subs = new Set<chrome.runtime.Port>();
let ctrl: AbortController | null = null;

// SW эфемерен: module-level state переживает закрытие окна, но НЕ терминатор SW
// (~30с idle). До правды доживает только выполненный результат: done/error пишем в
// chrome.storage.session, при новом подъёме SW восстанавливаем — иначе повторный клик
// по уже-готовому url видел бы IDLE и перезапускал стрим (бэкенд списал бы кредит дважды).
// Живой loading/streaming не персистим: активный SSE-fetch держит SW, а после обрыва
// безdone результат всё равно потерян — restore имеет смысл только для терминала.
const STATE_KEY = "conspect_stream_v1";
let restored = false;
const restoreP = (async () => {
  try {
    const v = await chrome.storage.session.get(STATE_KEY);
    const saved = v[STATE_KEY] as StreamState | undefined;
    if (saved && (saved.status === "done" || saved.status === "error")) state = { ...saved };
  } catch {
    /* session storage недоступен — работаем как раньше, из памяти */
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
  try { port.postMessage(msg); } catch { /* порт уже закрыт — подписчик ушёл */ }
}

function set(patch: Partial<StreamState>): void {
  state = { ...state, ...patch };
  broadcast();
  persist();
}
function broadcast(): void {
  const msg = { type: "state", ...state };
  for (const p of subs) safePost(p, msg);
}

// Новый подписчик: сразу получает снапшот текущего стрима (даже idle — чтобы понять,
// что генерации нет). Отписка НЕ останавливает стрим — он пережил закрытие окна.
// Если SW только поднялся и restore из session ещё не дошёл — дождёмся, иначе
// подпишчик получит IDLE поверх восстановленного done и запустит стрим заново.
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

// Сохранить готовый конспект в локальный кэш (self-host: сервер не хранит). meta-поля
// берём из текущего state — к моменту done они уже пришли событием meta.
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
  } catch { /* квота/недоступно — кэш не критичен */ }
}

export async function startStream(url: string): Promise<void> {
  // Подождать restore из session: если SW только поднялся, state ещё IDLE, а в session
  // лежит done для этого url — без ожидания guard не сработает и стрим перезапустится.
  if (!restored) await restoreP;
  // Тот же url и стрим жив (идёт или уже готов) — не перезапускаем: повторные клики
  // только переподписываются. Смена url — останавливаем предыдущий.
  if (state.url === url && isLive(state)) return;
  if (ctrl) try { ctrl.abort(); } catch { /* уже абортирован */ }
  ctrl = new AbortController();
  set({ ...IDLE, status: "loading", url });

  const st = await loadSettings();
  const baseUrl = st.baseUrl;
  if (!baseUrl || !st.sharedToken) {
    set({ status: "error", errorReason: "not_configured", error: REASON_TEXT.not_configured });
    return;
  }

  let accText = "";
  let phase: 0 | 1 | 2 = 0;
  try {
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/digest/stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${st.sharedToken}` },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
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
      // CRLF→LF: прокси/гейтвей переупаковывает фреймы с \r\n, и разделитель "\n\n"
      // не совпадает — копится без разбора.
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
        } else if (evt.type === "delta") {
          accText += (evt.delta as string) ?? "";
          phase = 2;
          set({ text: accText, status: "streaming", phase });
        } else if (evt.type === "done") {
          set({ text: accText, status: "done" });
          void cacheDigest(url, accText);
          return;
        } else if (evt.type === "error") {
          // #3: бэкенд иногда шлёт error в самом конце, когда текст уже весь пришёл
          // («доходит до конца и слетает»). Если накопилось — показываем готовый
          // конспект, маскируя серверный сбой финализации.
          const reason = (evt.reason as string | undefined) ?? "exception";
          if (accText.trim()) { set({ text: accText, status: "done" }); void cacheDigest(url, accText); }
          else set({ status: "error", errorReason: reason, error: REASON_TEXT[reason] ?? REASON_TEXT.exception });
          return;
        }
      }
    }
    // Поток закрылся без явного done/error (сеть/гейтвей оборвал без [DONE]).
    if (accText.trim()) { set({ text: accText, status: "done" }); void cacheDigest(url, accText); }
    else set({ status: "error", errorReason: "stream_closed", error: REASON_TEXT.stream_closed });
  } catch (e) {
    // Штатная остановка (stopStream/смена url) — abort, молча.
    if (ctrl?.signal.aborted) return;
    set({ status: "error", errorReason: "exception", error: REASON_TEXT.exception });
  }
}

// Явная остановка пользователем. Кредит списан бэкендом при старте запроса —
// накопленный текст засчитываем как готовый (как panelStore.stopStream раньше).
export function stopStream(): void {
  if (ctrl) { try { ctrl.abort(); } catch { /* уже */ } ctrl = null; }
  if (state.status === "loading" || state.status === "streaming") {
    if (state.text.trim()) { set({ status: "done" }); void cacheDigest(state.url, state.text); }
    else set({ ...IDLE });
  }
}

// Одно SSE-событие (несколько data:-строк склеиваются) → { type: event, ...data }.
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
