// Глобальное состояние стрима конспекта в service worker + очередь (#12). Живёт ВНЕ
// привязки к конкретному окну: один активный стрим, остальные url'ы ждут в очереди,
// много подписчиков (панель на YouTube, попап, кабинет, кнопка-триггер). Раньше стрим
// держал один порт: закрыл панель/попап → port.onDisconnect → AbortController.abort() →
// дорогой пайплайн умирал, частичный текст терялся (#11/#16). Теперь подписчик, ушедший
// без явной остановки, только отпишется — стрим доиграет до done, результат в SW.
//
// N=1 + очередь: активный стрим всегда один. start(url) на другом url ставит его в конец
// очереди (без дублей). done/error/stop активного продвигает очередь — следующий url
// стартует сам. Закрытие окна не снимает задачу из очереди: доиграет в фон, результат
// уйдёт в кэш. Пул N>1 позже делается заменой advanceQueue (брать по слоту, а не один).
//
// Протокол по порту "digest-stream":
//   подписчик → SW:  {type:"start", url} | {type:"stop"} | {type:"keepalive"}
//   SW → подписчик:  {type:"state", ...StreamState}   (полный снапшот на каждое изменение
//                    и сразу при подключении; queue — снимок ожидающих url'ов, в порядке)
import { getDigest, loadSettings, putDigest } from "./lib/store.js";
import { playDoneSound } from "./audio";
import { hashUrl, REASON_TEXT } from "./panel/format";

// Версия клиента, которую бэкенд пишет в лог — по ней видно, что пользователь
// перезагрузил расширение с актуальным keepalive.
const CLIENT_VERSION = "v3-queue";

export type StreamStatus = "idle" | "loading" | "streaming" | "done" | "error" | "cancelled";

// Элемент очереди: url + (опционально) заголовок. Заголовок резолвится по oEmbed, пока
// ролик ждёт своей очереди — чтобы в кабинете вместо хэша показывать полное название.
// startedAt — момент постановки: когда очередь дошла до ролика, таймер конспекта
// продолжает считать от него, а не стартует заново (общее время включает ожидание).
export type QueueItem = { url: string; title?: string; startedAt: number };

type StreamState = {
  status: StreamStatus;
  url: string;
  text: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  phase: 0 | 1 | 2; // 0 до meta, 1 meta, 2 пошёл delta — эвристика стадий loading §06
  progress: { i: number; n: number } | null; // чанкинг: «часть i/N», пока идёт map-фаза
  startedAt: number | null; // epoch-мс начала работы над url (клик или постановка в очередь)
  queue: QueueItem[]; // ожидающие url'ы (в порядке добавления) — снимок для подписчиков
  error: string; // человекочитаемый текст (REASON_TEXT); пусто для не-error
  errorReason: string; // сырой reason (not_authed/no_credits/…) — для маппинга в карточки
};

const IDLE: StreamState = {
  status: "idle", url: "", text: "", title: null, channel: null,
  durationSec: null, lang: null, phase: 0, progress: null, startedAt: null, queue: [], error: "", errorReason: "",
};

let state: StreamState = { ...IDLE };
const subs = new Set<chrome.runtime.Port>();
// Единственный источник очереди. state.queue — всегда снимок этого массива (set кладёт
// его поверх любого patch), сама очередь живёт здесь, в module-level, и НЕ персистится.
let queue: QueueItem[] = [];
let ctrl: AbortController | null = null;

// Кэш заголовков по url (oEmbed) — чтобы не дёргать YouTube повторно для одного ролика.
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
    // queue НЕ восстанавливаем: она в памяти и не доживает до терминатора SW. Снимок
    // из saved устарел бы (другой SW-подъём), держим чистый [].
    if (saved && (saved.status === "done" || saved.status === "error")) state = { ...saved, queue: [] };
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
  // queue подмешиваем всегда: любой patch не должен «терять» актуальную очередь.
  state = { ...state, ...patch, queue: [...queue] };
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

// Единый финал «готово»: терминальный state + кэш + звук-уведомление. Используем во
// всех ветках, где конспект реально собрался (SSE done, маскированный error, обрыв
// потока с текстом). stopStream звук НЕ играет — остановку инициировал сам пользователь.
function markDone(url: string, markdown: string): void {
  set({ text: markdown, status: "done" });
  void cacheDigest(url, markdown);
  void playDoneSound();
}

export async function startStream(url: string, since?: number): Promise<void> {
  // Подождать restore из session: если SW только поднялся, state ещё IDLE, а в session
  // лежит done для этого url — без ожидания guard не сработает и стрим перезапустится.
  if (!restored) await restoreP;
  // Тот же url и стрим жив (идёт или уже готов) — не перезапускаем: повторные клики
  // только переподписываются.
  if (state.url === url && isLive(state)) return;
  // Активный стрим занят другим url — ставим в очередь (без дублей, без лимита). N=1:
  // параллельно не генерируем, url ждёт своего момента. Когда активный done/error/stop —
  // advanceQueue запустит следующий и пробросит момент постановки (таймер без сброса).
  if (state.status === "loading" || state.status === "streaming") {
    if (!queue.some((q) => q.url === url)) {
      queue.push({ url, startedAt: since ?? Date.now() });
      set({}); // обновить снимок очереди в state + broadcast
      // Резолвим заголовок асинхронно: в кабинете очередь покажет название вместо хэша.
      void resolveTitle(url).then((t) => {
        const item = queue.find((q) => q.url === url);
        if (item && t && !item.title) { item.title = t; set({}); }
      });
    }
    return;
  }
  // Кэш: конспект для этого url уже собран и лежит в локальном хранилище — не гоняем
  // пайплайн и не жжём LLM-кредит повторно, сразу отдаём готовый markdown. Проверяем
  // здесь, ПОСЛЕ ветки очереди: если активный стрим занят другим url, глобальный state
  // один — переключение его на «done» поверх живого стрима давало бы гонку с delta.
  // В очереди url дождётся освобождения и сюда вернётся уже без активного стрима.
  // Сброс кэша — удаление конспекта в кабинете (deleteDigest): снова сгенерирует.
  // Без звука и перекэширования, поэтому прямой set, не markDone.
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

// Продвинуть очередь: взять следующий url и запустить. Один вызов — один запуск;
// вызывается в finally runStream (done/error/abort активного освободили слот).
// Пробрасываем startedAt постановки: таймер конспекта считает общее время с ожиданием.
function advanceQueue(): void {
  const next = queue.shift();
  if (next) void startStream(next.url, next.startedAt);
}

// Убрать url из очереди ожидающих (активный стрим не трогаем — его останавливают
// через stopStream). Кабинет показывает очередь и даёт удалить лишний url.
export function removeFromQueue(url: string): void {
  const i = queue.findIndex((q) => q.url === url);
  if (i < 0) return;
  queue.splice(i, 1);
  set({}); // обновить снимок очереди + broadcast
}

// Переставить url в очереди (drag-and-drop в кабинете): fromIndex → toIndex.
export function reorderQueue(fromIndex: number, toIndex: number): void {
  if (fromIndex < 0 || fromIndex >= queue.length) return;
  if (toIndex < 0 || toIndex >= queue.length) return;
  if (fromIndex === toIndex) return;
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  set({});
}

// Кэш конспектов чистят в кабинете (deleteDigest/clearDigests в background.ts). Если
// удалённый url был в терминальном done, сбрасываем state в idle — иначе повторный
// startStream(url) упрётся в guard «url тот же и стрим жив» и молча не перезапустит
// генерацию (кэш уже пуст, пользователь видит старый done без текста). Активный
// loading/streaming не трогаем: стрим доиграет и перекэширует сам.
export function invalidateDone(urlHash: string): void {
  if (!state.url || state.status !== "done") return;
  if (hashUrl(state.url) === urlHash) set({ ...IDLE });
}
export function invalidateAllDone(): void {
  if (state.status === "done") set({ ...IDLE });
}

async function runStream(url: string, since?: number): Promise<void> {
  if (ctrl) try { ctrl.abort(); } catch { /* уже абортирован */ }
  ctrl = new AbortController();
  // Локальная копия контроллера: фикс гонки, когда stopStream/смена url переставляют
  // module-level ctrl, а старый catch писал ошибку поверх нового loading-состояния.
  const myCtrl = ctrl;
  // startedAt — от постановки в очередь (since), не от старта генерации: ролик, час
  // ждавший в очереди, не должен «обнулять» таймер. Прямой старт — момент клика.
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
  // Keepalive: браузер выгружает MV3-сервис-воркер, если тот idle дольше ~30с. Между
  // meta и первым delta большой транскрипт держит LLM в «думании» десятки секунд —
  // активный SSE-fetch не всегда сбрасывает idle-таймер, SW умирает, порт панели рвётся
  // и панель показывает «Соединение прервалось», хотя бэкенд продолжает генерить.
  // Тривиальный вызов chrome.runtime раз в 20с сбрасывает таймер и держит SW живым.
  const keepalive = setInterval(() => {
    // Документированный keepalive (Chrome 114+): ОТПРАВКА сообщения по long-lived-порту
    // сбрасывает idle-таймер SW. «ping» панель игнорирует (не state), но сам факт отправки
    // держит воркер живым во время долгого «думания» LLM. getPlatformInfo — вторая линия.
    void chrome.runtime.getPlatformInfo().catch(() => {});
    for (const p of subs) safePost(p, { type: "ping" });
    // Диагностика: /ping каждые 20с. По прерыванию этих строк в логе бэкенда видно,
    // жил ли SW и на какой секунде замолчал.
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
        } else if (evt.type === "progress") {
          // Чанкинг: map-фаза идёт до первого delta merge. Показываем «часть i/N».
          set({ progress: { i: Number(evt.i) || 0, n: Number(evt.n) || 0 } });
        } else if (evt.type === "delta") {
          accText += (evt.delta as string) ?? "";
          phase = 2;
          set({ text: accText, status: "streaming", phase, progress: null });
        } else if (evt.type === "done") {
          markDone(url, accText);
          return;
        } else if (evt.type === "error") {
          // #3: бэкенд иногда шлёт error в самом конце, когда текст уже весь пришёл
          // («доходит до конца и слетает»). Если накопилось — показываем готовый
          // конспект, маскируя серверный сбой финализации.
          const reason = (evt.reason as string | undefined) ?? "exception";
          if (accText.trim()) markDone(url, accText);
          else set({ status: "error", errorReason: reason, error: REASON_TEXT[reason] ?? REASON_TEXT.exception });
          return;
        }
      }
    }
    // Поток закрылся без явного done/error (сеть/гейтвей оборвал без [DONE]).
    if (accText.trim()) markDone(url, accText);
    else set({ status: "error", errorReason: "stream_closed", error: REASON_TEXT.stream_closed });
  } catch (e) {
    // Штатная остановка (stopStream/смена url) — abort, молча. myCtrl, не ctrl:
    // module-level ctrl мог уже указывать на контроллер следующего стрима.
    if (myCtrl.signal.aborted) return;
    set({ status: "error", errorReason: "exception", error: REASON_TEXT.exception });
  } finally {
    clearInterval(keepalive);
    advanceQueue();
  }
}

// Явная остановка пользователем. Кредит списан бэкендом при старте запроса —
// накопленный текст засчитываем как готовый (как panelStore.stopStream раньше).
// Очередь не трогаем: abort активного разбудит advanceQueue в finally runStream,
// следующий url стартует сам.
export function stopStream(): void {
  if (ctrl) { try { ctrl.abort(); } catch { /* уже */ } ctrl = null; }
  if (state.status === "loading" || state.status === "streaming") {
    if (state.text.trim()) { set({ status: "done" }); void cacheDigest(state.url, state.text); }
    else {
      // Без текста — показываем «Прервано» в панели/попапе, затем автосброс в idle
      // (панель закрывается сама). startedAt сохраняем, чтобы таймер досчитал до конца.
      set({ status: "cancelled" });
      setTimeout(() => { if (state.status === "cancelled") set({ ...IDLE }); }, 2000);
    }
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
