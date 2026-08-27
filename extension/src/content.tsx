// Content script на youtube.com. Инжектит кнопку-«Конспект» на watch-страницах
// (круглая тёмная кнопка #0f0f0f с хром-монограммой-C в строке действий под плеером, в свой
// Shadow DOM) и плавающую панель-оверлей (тоже Shadow DOM). По клику открывается
// порт к background и стримится конспект — React-панель подписана на внешний стор
// и обновляется live.
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
  syncTriggerVisibility();
}

// YouTube при скролле сворачивает метадату и в ряде режимов делает её position:sticky/
// fixed (ytd-watch-metadata / #above-the-fold). Кнопка-сиблинг #subscribe-button наследует
// это и «уезжает» поверх контента, хотя должна уйти вместе с блоком. Прячем кнопку, пока
// она в sticky/fixed-предке. Обычный скролл (блок ушёл из viewport) уносит её сам.
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

// Щит клика по feed-кнопке: window-CAPTURE-слушатель перехватывает событие раньше
// любых делегатов YouTube (даже раньше document-capture) и гасит его, а действие
// (openPanel) выполняет сам. Обычный bubble-suppress на кнопке надёжен не всегда:
// в части роллаутов YouTube карточка перекрывает кнопку hover-оверлеем (событие
// вообще не доходит до кнопки) или слушает событие в capture-фазе раньше нас.
// composedPath() виден сквозь открытый Shadow DOM; url лежит в data-cs-url хоста.
// preventDefault не ставим на pointerdown: по спецификации Pointer Events он
// подавляет совместимые mouse-события; click нужен щиту для экшена.
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

// Кнопка на карточках ленты/поиска/related/плейлистов («Смотреть позже» = playlist?list=WL)
// (точка C1): overlay-пилюля на превью,
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

// Ближайший предок, реально служащий containing block'ом для position:absolute-потомка:
// генерирует box (не display:contents) и position != static. Нет такого — documentElement
// (initial containing block). Нужен фолбэк-пути injectFeedCard, где кнопка на карточке.
function containingBlock(el: HTMLElement): HTMLElement {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "contents") continue;
    if (cs.position !== "static") return e;
  }
  return document.documentElement;
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
  // Кнопку крепим к обёртке превью (ytd-thumbnail), а не к карточке: обёртка —
  // реальный box, relative + left/top 8px держат кнопку в левом-верхнем углу превью.
  // Новая вёрстка главной (yt-lockup-view-model) развернула дерево: yt-thumbnail-view-model
  // лежит ВНУТРИ <a href="/watch">, и посадка кнопки в «обёртку» снова оказывалась
  // посадкой в ссылку — клик уходил в навигацию на видео. closest("a") ловит оба случая
  // посадки на/в ссылку (включая старый якорь a#thumbnail): тогда host крепим к РОДИТЕЛЮ
  // ссылки, а офсет считаем от rect ссылки — родитель-холдер шире самой ссылки, простые
  // 8px ставили бы кнопку мимо превью.
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
    // Офсет от containing block'а hostParent: он может быть display:contents
    // (контейнеры новой вёрстки) и не принять relative — тогда блоком служит
    // ближайший box выше по дереву. Считаем от hostParent, а не от host:
    // host ещё не в дереве (appendChild ниже), его предки пусты, и containingBlock
    // вернул бы documentElement — кнопка съезжала на главной.
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
  // Скоуп stacking context на родителе, иначе z-index кнопки уходит на уровень страницы
  // и она рисуется поверх fixed-шапки YouTube (masthead z-index 2020) при скролле.
  hostParent.style.setProperty("isolation", "isolate", "important");
  hostParent.appendChild(host);
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
  const curId = /[?&]v=/.test(location.href) ? videoId(location.href) : null;
  if (st.status !== "closed" && curId && curId !== videoId(st.url)) {
    closePanel();
  }
  // Автооткрытие (#8): вернулись на ролик, для которого недавно открывали конспект, а
  // панель закрылась навигацией. Стрим в SW доиграл/доигрывает — openPanel вернёт снапшот
  // (streaming/done). Ограничиваем 10 минутами, чтобы панель не всплывала сама спустя часы.
  const last = getLastOpen();
  if (st.status === "closed" && last.url && curId && curId === videoId(last.url) && Date.now() - last.at < 10 * 60 * 1000) {
    openPanel(last.url);
  }
  arm();
}
document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("load", arm);
// Следим за «прилипанием» кнопки-триггера: если YouTube сделал её предок sticky/fixed
// (сворачивание метадаты при скролле), прячем кнопку; вернулся обычный поток — показываем.
window.addEventListener("scroll", scheduleSyncTriggerVisibility, { passive: true });
window.addEventListener("resize", scheduleSyncTriggerVisibility);
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
