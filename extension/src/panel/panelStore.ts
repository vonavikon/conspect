// Внешнее хранилище панели + подписка на глобальный стрим (streamStore в SW). Живёт
// вне React: content-скрипт дёргает openPanel(url), панель и кнопка подписаны через
// useSyncExternalStore. Стрим держит SW — панель лишь подписчик: закрывая окно
// (closePanel), мы только отписываем порт, дорогая генерация доигрывает в фоне, окно
// можно вернуть повторным кликом (#11/#16). Текст появляется live: SSE → SW → broadcast.
//
// Throttle рендера (120мс) — внутри scheduleTextFlush, не на каждый delta: SW шлёт
// снапшот на каждый токен, мы накапливаем text в pendingText и кладём в state по таймеру.
// 120, не 60: markdown ре-парсится на каждом flush, реже flush → меньше CPU на длинном
// стриме; визуально не отличается. Переход loading→streaming и смена meta — сразу.
import { REASON_TEXT, type Meta } from "./format";

type PanelStatus =
  | "closed"
  | "loading"
  | "streaming"
  | "done"
  | "error";

export type PanelState = {
  status: PanelStatus;
  url: string;
  text: string;
  meta: Meta;
  errorText: string;
};

const initial: PanelState = {
  status: "closed",
  url: "",
  text: "",
  meta: {},
  errorText: "",
};

let state: PanelState = initial;
const listeners = new Set<() => void>();

// Иммутабельная замена → между изменениями getPanelState возвращает стабильную
// ссылку (useSyncExternalStore корректно пропускает ре-рендер).
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

// --- подписка на стрим ---
let port: chrome.runtime.Port | null = null;
// portId — epoch порта. disconnectPort инкрементирует → слушатели старого порта
// (onMessage/onDisconnect) видят myId !== portId и молчат. Без этого onDisconnect
// старого порта при rotate/close срабатывал бы постфактум и вешал ложную ошибку
// «stream_closed» на свежую сессию. Текущий порт (SW умер) — myId === portId → ошибка.
let portId = 0;
// url текущей панели: фильтр от снапшотов чужого стрима. При rotate на другой url SW
// сначала пришлёт снапшот ещё-идущего старого стрима — пропускаем, ждём свой.
let openedUrl = "";
// Видели ли уже не-idle состояние стрима. idle до этого — стартовый снапшот (до того,
// как SW успел поставить loading), игнорируем, optimistic loading держим. idle после —
// «остановлен без текста» → закрываем панель.
let seen = false;
// Последний текст от SW; кладётся в state.text по таймеру (throttle), не на каждый токен.
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
  if (!port) return;
  portId++; // инвалидировать слушатели этого порта
  const p = port;
  port = null;
  try {
    p.disconnect();
  } catch {
    /* порт уже мёртв */
  }
}

// SW → панель: {type:"state", ...StreamState}. Маппим в PanelState.
type StreamSnap = {
  status: string;
  url: string;
  text: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  error: string;
  errorReason: string;
};

function applyState(s: StreamSnap): void {
  if (s.status === "idle") {
    // До первого настоящего состояния — стартовый снапшот, игнор (optimistic loading).
    // После — стрим кончился без текста (остановлен/схлопнулся) → закрываем панель.
    if (seen) closePanel();
    return;
  }
  // Снапшот чужого стрима при rotate — пропускаем, ждём свой.
  if (s.url && openedUrl && s.url !== openedUrl) return;

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
    set({ status: "error", url: s.url, text: pendingText, meta, errorText: s.error || REASON_TEXT.exception });
    return;
  }
  if (s.status === "done") {
    flushNow();
    set({ status: "done", url: s.url, text: pendingText, meta });
    return;
  }
  // loading / streaming. Растёт только текст (streaming→streaming) — throttle, без
  // лишнего ре-рендера; переход loading→streaming (первый delta) и смена meta — сразу.
  if (!(s.status === "streaming" && state.status === "streaming")) {
    set({ status: s.status as PanelStatus, url: s.url, meta });
  }
  scheduleTextFlush();
}

export function openPanel(url: string): void {
  // Тот же ролик и панель уже показывает идущий/готовый конспект — клик лишний: не
  // перезапускаем, не моргаем. Смена видео или retry после ошибки — проходит. Idempotency
  // самого стрима (повторный start того же url) дополнительно страхует в streamStore.
  if (state.status !== "closed" && state.status !== "error" && state.url === url) return;
  openedUrl = url;
  seen = false;
  pendingText = "";
  flushNow();
  set({ status: "loading", url, text: "", meta: {}, errorText: "" });
  disconnectPort(); // старый подписчик уходит; стрим в SW продолжается
  const my = ++portId;
  // connect бросает синхронно «Extension context invalidated», если вкладка держит
  // осиротевший content script после обновления расширения. Без try/catch клик по
  // триггеру/feed-кнопке ронял бы необработанное исключение. Честная ошибка вместо него.
  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connect({ name: "digest-stream" });
  } catch {
    set({ status: "error", errorText: "Расширение обновилось. Обновите страницу YouTube." });
    return;
  }
  port = p;
  p.onMessage.addListener((m: StreamSnap) => {
    if (my !== portId) return;
    if (m && (m as { type?: string }).type === "state") applyState(m);
  });
  // SW умер / выгрузился, порт порвался сам (не через disconnectPort) — стрим потерян.
  // Не оставляем «вечный streaming»: честная ошибка. my !== portId отсеивает старый порт.
  p.onDisconnect.addListener(() => {
    if (my !== portId) return;
    port = null;
    if (state.status === "loading" || state.status === "streaming") {
      set({ status: "error", errorText: REASON_TEXT.stream_closed });
    }
  });
  try {
    p.postMessage({ type: "start", url });
  } catch {
    /* контекст стал невалиден между connect и post — onDisconnect даст ошибку */
  }
}

export function closePanel(): void {
  // Только отписка: стрим в SW доигрывает в фоне. Панель можно вернуть openPanel-ом.
  flushNow();
  pendingText = "";
  seen = false;
  openedUrl = "";
  disconnectPort();
  set({ status: "closed", url: "", text: "", meta: {}, errorText: "" });
}

// Остановить генерацию по требованию пользователя. Кредит списан бэкендом при старте
// запроса — досрочная остановка его не возвращает. SW финализирует накопленным текстом
// (done — показываем конспект) либо, если текста не пришло, идёт в idle → панель
// закроется в applyState. Порт держим до финального state.
export function stopStream(): void {
  try {
    port?.postMessage({ type: "stop" });
  } catch {
    /* порт уже ушёл — SW финализирует без нас */
  }
}

export function isBusy(): boolean {
  return state.status === "loading" || state.status === "streaming";
}
