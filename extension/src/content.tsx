// Content script на youtube.com. Инжектит кнопку-«Конспект» на watch-страницах
// (круглая тёмная кнопка #0f0f0f с хром-монограммой-C в строке действий под плеером, в свой
// Shadow DOM) и плавающую панель-оверлей (тоже Shadow DOM). По клику открывается
// порт к background и стримится конспект — React-панель подписана на внешний стор
// и обновляется live.
import { mountShadow } from "./panel/shadowApp";
import { TriggerButton } from "./panel/TriggerButton";
import { FeedButton } from "./panel/FeedButton";
import { ConspectPanel } from "./panel/ConspectPanel";
import { closePanel, getPanelState, openPanel } from "./panel/panelStore";
import { injectFonts } from "./lib/fonts";
import { videoId } from "./panel/format";
import type { Root } from "react-dom/client";

const TRIGGER_HOST_ID = "conspect-trigger-host";
const PANEL_HOST_ID = "conspect-panel-host";

function isWatch(): boolean {
  return location.pathname === "/watch";
}

// После обновления/переустановки расширения открытые YouTube-вкладки держат
// осиротевший content script: chrome.runtime.id становится undefined, а connect/
// sendMessage синхронно бросают «Extension context invalidated». Гuard перед любым
// chrome.runtime-вызовом; при orphaning останавливаем обсервер, чтобы не молотить
// исключениями на каждой мутации.
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// Оверлей-хост для панели: фиксированный, на весь viewport, прозрачен для кликов
// (pointer-events:none) — сама карточка включает клики у себя. Один на страницу.
// Крепим к documentElement, не к body: YouTube SPA при навигации меняет детей body,
// и прямой дочерний host мог бы быть снесён вместе с ними.
function ensurePanelHost(): void {
  if (document.getElementById(PANEL_HOST_ID)) return;
  const host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
  (document.documentElement ?? document.body).appendChild(host);
  mountShadow(host, <ConspectPanel />);
}

// Реальная точка крепления: #subscribe-button внутри стабильного #owner (живая
// метадата ytd-watch-metadata / #above-the-fold). Держимся за #owner, а не за самим
// #subscribe-button — тот встречается и в #meta-skeleton (заглушка-скелет), который YT
// прячет ([hidden]) после загрузки метадаты. Кнопка, привязанная к скелету, уходила в
// display:none и оставалась невидимой (offsetParent=null), а ранний return по «host уже
// есть» не давал её перепривязать. В #owner такого нет.
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
  // Хост на месте, внутри #owner и виден — ок. offsetParent===null ловит и спрятанного
  // предком (скелет/hidden), и display:none — в обоих случаях перепривязываем.
  if (existing && existing.closest("#owner") && existing.offsetParent !== null) return;
  // Осиротевший/спрятанный хост (YT перерисовал мету) — убираем вместе с React-корнем:
  // иначе при каждой перепривязке накапливался unmount'нутый root (утечка).
  if (existing) {
    existing.remove();
    if (triggerRoot) {
      triggerRoot.unmount();
      triggerRoot = null;
    }
  }
  const sub = ownerSubscribeButton();
  if (!sub || !sub.parentNode) return; // #owner ещё не готов — наблюдатель повторит
  const triggerHost = document.createElement("div");
  triggerHost.id = TRIGGER_HOST_ID;
  triggerHost.style.cssText = "display:inline-flex;align-items:center;margin-left:10px";
  // Следующий сиблинг #subscribe-button внутри #owner: кнопка встаёт в той же строке,
  // сразу справа от «Подписаться», а не под ней.
  sub.parentNode.insertBefore(triggerHost, sub.nextSibling);
  triggerRoot = mountShadow(triggerHost, <TriggerButton />).root;
  ensurePanelHost();
}

const FEED_HOST_ID = "conspect-feed-host";

// Живые React-корни feed-кнопок. YouTube рециклит/выбрасывает карточки при скролле
// и SPA-навигации; host уходит из DOM, но Shadow-корень + antd cssinjs-стили +
// слушатели порта без явного unmount копятся → утечка. Prune убирает осиротевшие.
const feedRoots = new Map<HTMLElement, Root>();

function pruneFeedRoots(): void {
  for (const [host, root] of feedRoots) {
    if (host.isConnected) continue;
    root.unmount();
    feedRoots.delete(host);
  }
}

// Кнопка на карточках ленты/поиска/related (точка C1): overlay-пилюля на превью,
// клик запускает конспект того же URL через общую панель. ensurePanelHost — панель
// нужна и на не-watch страницах (на watch её ставит injectTrigger). Селекторы
// YouTube плывут — перебираем несколько типов карточек.
//
// Батчим инъекцию (rule #6 master skill): на ленте/поиске десятки карточек, а на
// каждой style.setProperty + createRoot молотят layout. Режем по 20 с yield (rAF)
// между батчами, чтобы не блокировать main thread. inFlight-флаг сериализует вызовы
// от коалесцирующего таймера — пока один проход идёт, повторный пропускается.
let feedInFlight = false;
async function injectFeedButtons(): Promise<void> {
  if (feedInFlight) return;
  feedInFlight = true;
  try {
    pruneFeedRoots();
    ensurePanelHost();
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model"
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

// Thumbnail-контейнер карточки — куда вешаем кнопку-пилюлю (чтобы она была на превью,
// а не на краю строки). Старая вёрстка: ytd-thumbnail (rich/video/compact/grid). Новая
// (view-model в related-колонке справа): yt-thumbnail-view-model. Фолбэки — якорь
// a#thumbnail / a[href*=watch]. Не нашли — сама карточка.
function thumbAnchor(card: HTMLElement): HTMLElement {
  return (
    card.querySelector<HTMLElement>("ytd-thumbnail") ??
    card.querySelector<HTMLElement>("yt-thumbnail-view-model") ??
    card.querySelector<HTMLElement>('a#thumbnail[href*="/watch"]') ??
    card.querySelector<HTMLElement>('a[href*="/watch"]') ??
    card
  );
}

// Одна карточка ленты/поиска/related: overlay-пилюля на превью.
function injectFeedCard(card: HTMLElement): void {
  const link = card.querySelector<HTMLAnchorElement>(
    'a#thumbnail[href*="/watch"], a[href*="/watch"]'
  );
  if (!link) return;
  const url = link.href;
  if (!/[?&]v=/.test(url)) return;
  const existing = card.querySelector<HTMLElement>("#" + FEED_HOST_ID);
  // YouTube рециклит compact/rich-карточки при скролле: один DOM-узел получает
  // новый a[href]. По data-cs-url ловим рассинхрон — перепривязываем кнопку на
  // свежий URL, иначе она навсегда остаётся на превью первого ролика карточки.
  if (existing && existing.dataset.csUrl === url) return;
  if (existing) {
    const root = feedRoots.get(existing);
    if (root) root.unmount();
    feedRoots.delete(existing);
    existing.remove();
  }
  // Кнопка на превью, но крепим к карточке, а не к thumbnail: иначе host попадал внутрь
  // ссылки a#thumbnail (клик уходил в навигацию на видео) и под hover-оверлеи YouTube
  // (mute/CC в поиске), которые его перекрывали. Координаты считаем от угла превью
  // относительно карточки. Левый-верхний угол: правый-верхний в поиске занимают кнопки
  // звука/субтитров, нижние — бейдж длительности и прогресс предпросмотра.
  const anchor = thumbAnchor(card);
  const cardRect = card.getBoundingClientRect();
  const thumbRect = anchor.getBoundingClientRect();
  const left = Math.max(0, Math.round(thumbRect.left - cardRect.left + 8));
  const top = Math.max(0, Math.round(thumbRect.top - cardRect.top + 8));
  const host = document.createElement("div");
  host.id = FEED_HOST_ID;
  host.dataset.csUrl = url;
  host.style.cssText =
    `position:absolute!important;left:${left}px!important;top:${top}px!important;z-index:2147483646!important;pointer-events:auto;display:block;width:32px;height:32px;`;
  if (getComputedStyle(card).position === "static") card.style.setProperty("position", "relative", "important");
  card.appendChild(host);
  const { root } = mountShadow(host, <FeedButton url={url} />);
  feedRoots.set(host, root);
}

// ?cs-auto=1 на watch-странице — авто-открыть панель и запустить конспект. Ставится
// попапом при запуске по вставленной ссылке (вне YouTube): открываем watch с этим
// флагом, content auto-стартует. Один раз на загрузку.
let autoApplied = false;
function readAuto(): void {
  if (autoApplied) return;
  if (new URLSearchParams(location.search).get("cs-auto") !== "1") return;
  if (!isWatch()) return;
  autoApplied = true;
  ensurePanelHost();
  openPanel(location.href);
}

// Попап шлёт {type:"cs-open-panel"} с активной watch-вкладки (CTA «Сделать конспект»).
// Открываем панель на текущем видео. URL берём из location вкладки — попап уже
// отфильтровал, что активная вкладка это /watch?v=.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isExtensionContextValid()) return;
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "cs-open-panel" && isWatch()) {
    ensurePanelHost();
    openPanel(location.href);
  }
});

// (Пере)инжект при SPA-навигации + пока кнопка не встанет (DOM может догружаться).
function arm(): void {
  // Orphaning после обновления расширения: дальше каждый chrome.runtime-вызов бросает.
  // Останавливаем обсервер, чтобы не молотить arm() на каждой мутации осиротевшей вкладки.
  if (!isExtensionContextValid()) {
    obs.disconnect();
    return;
  }
  injectFonts();
  injectTrigger();
  void injectFeedButtons();
  readAuto();
}
// Панель, открытая из ленты (точка C1), живёт в position:fixed-оверлее и не
// привязана к странице. При уходе на watch ДРУГОГО ролика — закрываем, чтобы
// чужой конспект не висел над новым видео. Тот же ролик (лента → его watch) —
// оставляем. Переход на не-watch (лента/поиск/главная) — панель оставляем:
// иначе автозакрытие рубило бы панель, открытую прямо в ленте (yt-navigate-finish
// иногда диспаттится без смены ролика).
function onNavigate(): void {
  const st = getPanelState();
  if (st.status !== "closed" && /[?&]v=/.test(location.href) && videoId(location.href) !== videoId(st.url)) {
    closePanel();
  }
  arm();
}
document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("load", arm);
// YouTube мутирует DOM сотнями раз в секунду (плеер, тултипы, счётчики лайков).
// Коалесцируем все инжекты одним таймером 150мс — иначе querySelectorAll по карточкам
// и offsetParent-проверка триггера молотят layout на каждом муте. arm() сам коротит:
// триггер сразу выходит, когда уже стоит правильно; feed — когда хосты на всех карточках.
let armTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleArm(): void {
  if (armTimer !== undefined) clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armTimer = undefined;
    arm();
  }, 150);
}
// E3: YouTube мутирует DOM сотнями раз/сек, но нас интересуют только структурные
// изменения (добавление/удаление элементов — карточки ленты, появление #owner).
// Мутации текста (пересчёт счётчиков, тултипы) — childList с текстовыми узлами;
// фильтруем их, иначе коалесцирующий таймер молотит на каждом обновлении текста.
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
