// Skeuomorphism дизайн-система «Конспект» (айдентика ui-identities №5, материал Карбон):
// углеродное плетение, холодное серебро объёмов, изумрудный CTA. Канон —
// wiki/projects/conspect/mockup/skeuo-variants/carbon.html. В отличие от бронзы, акценты
// разнесены: primary CTA-кнопки зелёные, таймкоды/фокус/stage — янтарные (brand conspect),
// металл (Clogo/круг-триггер/точки секций) — холодное серебро. Три природы, не одна.
//
// Почему inline + cs-* классы, а не antd-style createStyles: createStyles гонит стили
// через emotion в document.head, а контент-панель живёт в Shadow DOM — туда не попадёт.
// Skeuo-объём (градиенты/тени/состояния) вынесен в cs-* CSS-классы (skeuoCss), которые
// каждый shadow-компонент вставляет своим <style>. antd-токены уходят в shadow через
// StyleProvider({ container }).
//
// Шрифты с Google Fonts (content.tsx / options.html инжектят <link>). TODO перед CWS:
// self-host woff2 (privacy + стойкость к style-src CSP YouTube).
import type { CSSProperties } from "react";
import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";

// ---------- палитра (Карбон) ----------
export const BG = "#0c0c0e"; // фон страницы/панели
export const CARD = "#151517"; // base поверхности (для мест без gradient)
export const CELL = "#0a0a0c"; // вдавленные поля/ячейки (темнее surface)
export const CELL2 = "#101012";
export const HOVER = "#26262a";
export const LINE = "#1a1a1d"; // border-soft
export const LINE2 = "#26262a"; // border светлее
export const TEXT = "#ececee";
export const SEC = "#a8a8ad";
// Приглушённый читаемый текст (мета, лейблы, placeholder, стадии, auth-hint). На карбоновом
// фоне #6a6a72 даёт достаточный контраст. Иерархия SEC (#a8a8ad) остаётся светлее.
export const MUT = "#6a6a72";
export const DIM = "#3a3a3e";
export const YT_BLUE = "#3ea6ff";
export const OK = "#2ea66f";
export const WARN = "#d9a441";
export const ERR = "#e25c5c";
export const AMBER = "#f5a623";

// ---------- серебряный radial-металл (Clogo, круг-триггер, точки секций) ----------
// Канон carbon.html: холодное серебро, высокий блик сверху-слева → тёмный край.
export const METAL_RADIAL = "radial-gradient(circle at 32% 26%, #ffffff 0%, #f0f0f2 10%, #c0c0c4 22%, #9a9a9f 42%, #6a6a72 62%, #4a4a4f 80%, #2a2a2e 94%, #08080a 100%)";
// Точка секции в панели (adot) — компактнее, без тёмного края.
export const METAL_DOT = "radial-gradient(circle at 35% 30%, #ffffff, #f0f0f2 30%, #9a9a9f 62%, #4a4a4f 92%, #1f1f22)";
// Amber-точка (stage.active, hero-pip) — янтарный brand-акцент, остаётся.
export const AMBER_RADIAL = "radial-gradient(circle at 32% 26%, #ffd687, #f5a623 55%, #8a5a10)";
// Amber-бордер для таймкод-бейджа (CTA_BORDER в карбоне зелёный, таймкод — янтарный, раздельно).
export const AMBER_BORDER = "#8a5a10";
// Amber-градиент таймкод-бейджа (brand conspect, не зависит от материала).
export const AMBER_GRAD = "linear-gradient(180deg,#ffc457,#f5a623 50%,#d4881a)";

// ---------- skeuo-поверхности (градиенты 180deg с фаской) ----------
export const BORDER = "#08080a"; // тёмный outer-border карточек/панели
export const SURFACE = "linear-gradient(180deg,#1f1f22,#151517)"; // карточка/панель
export const SURFACE_HEAD = "linear-gradient(180deg,#26262a,#1a1a1d)"; // шапка panel/loader
export const BTN = "linear-gradient(180deg,#2a2a2e,#1c1c1f 48%,#161618 52%,#1f1f22)";
export const BTN_BORDER = "#08080a";
export const CTA = "linear-gradient(180deg,#3ec47f,#2ea66f 50%,#248a5c)"; // изумрудный CTA
export const CTA_BORDER = "#1f5c40";
export const INPUT_BG = "#0a0a0c";

// ---------- skeuo-тени (суть стиля: bevel + drop) ----------
// Мягче и темнее бронзы: карбон матовый, фаска приглушена, drop глубже.
export const SHADOW_BTN = "inset 0 1px 0 rgba(255,255,255,.18), inset 0 -2px rgba(0,0,0,.55), 0 4px 7px rgba(0,0,0,.65)";
export const SHADOW_BTN_PRESS = "inset 0 2px 4px rgba(0,0,0,.7), inset 0 -1px rgba(255,255,255,.03)";
export const SHADOW_CARD = "inset 0 1px 0 rgba(255,255,255,.05), 0 8px 16px rgba(0,0,0,.7)";
export const SHADOW_BADGE = "inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px rgba(0,0,0,.35), 0 2px 4px rgba(0,0,0,.55)";
export const TXT_SHADOW = "0 1px rgba(0,0,0,.6)";

// ---------- шрифты ----------
export const FONT_SANS = '"Onest", Roboto, Arial, sans-serif';
export const FONT_MONO = '"PT Mono", ui-monospace, monospace';
export const EASE = "cubic-bezier(.22,.61,.36,1)";

// ---------- antd ThemeConfig ----------
// dark algorithm. colorPrimary = серебро: antd-интерактив (Switch/Checkbox/Radio/Slider/focus)
// становится металлом одной природы с объёмами. Зелёный (главный продукт-акцент) живёт только
// на явных CTA-кнопках (.cs-btn.filled) и done-семантике — отдельно от antd-токенов. Имя
// darkTheme() пришло на смену glassTheme() (editorial) — импортируется из shadowApp/options.
export function darkTheme(): ThemeConfig {
  return {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: SEC,
      colorInfo: YT_BLUE,
      colorSuccess: OK,
      colorError: ERR,
      colorWarning: WARN,
      colorBgBase: BG,
      colorBgContainer: CARD,
      colorBgElevated: CARD,
      colorBorder: LINE2,
      colorBorderSecondary: LINE,
      colorText: TEXT,
      colorTextSecondary: SEC,
      colorTextTertiary: MUT,
      borderRadius: 9,
      borderRadiusLG: 12,
      borderRadiusSM: 7,
      motionDurationSlow: "0.2s",
      motionDurationMid: "0.15s",
      motionDurationFast: "0.1s",
      fontFamily: FONT_SANS,
    },
    components: {
      Card: { borderRadiusLG: 12, colorBgContainer: CARD },
      Button: { borderRadius: 9, controlHeight: 36, primaryShadow: "none" },
      Input: { borderRadius: 9, controlHeight: 36, colorBgContainer: CELL },
      Alert: { borderRadiusLG: 12 },
      Segmented: { borderRadius: 9 },
    },
  };
}

// ---------- блоки ----------
// Skeuo-каркас панели: градиентная карбоновая поверхность + объёмная тень + тёмный кантик.
export const panelBox: CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  boxShadow: SHADOW_CARD,
  borderRadius: 14,
};

// Keyframes анимаций. Вставляются в <style> каждого shadow-компонента (keyframes в
// Shadow DOM не наследуются от document).
export const spinKeyframes = `@keyframes clogo-spin{to{transform:rotate(360deg)}}`;

// Сканлайн на фоне экрана загрузки: тонкие TV-линии, сверху вниз проходит янтарная полоса.
export const scanKeyframes = `@keyframes cs-scan{from{top:-60px}to{top:100%}}`;

// Icon swap (transitions.dev №09): кросс-фейд двух иконок в одной grid-ячейке — уходящий
// слой в blur(2px)+scale(.25), входящий из него. Оба ребёнка всегда в DOM: :first-child —
// состояние «работы» (спиннер/иконка действия), :last-child — «готово». Класс .done на
// контейнере переключает. Переиспользуется попапом, панелью, читалкой, кабинетом, FeedButton.
export const swapCss = `
.cs-swap{display:inline-grid;place-items:center}
.cs-swap>*{grid-area:1/1;transition:opacity .25s ease-in-out,filter .25s ease-in-out,transform .25s ease-in-out}
.cs-swap>:last-child{opacity:0;filter:blur(2px);transform:scale(.25)}
.cs-swap.done>:first-child{opacity:0;filter:blur(2px);transform:scale(.25)}
.cs-swap.done>:last-child{opacity:1;filter:blur(0);transform:scale(1)}
`;

// Success check (transitions.dev №10, мини-вариант под 10-12px иконки): fade из blur +
// доворот от 30deg + Y-bob + прорисовка stroke (pathLength=100 нормализует dasharray
// без getTotalLength). Длительности ужаты с 500ms эталона до 220-300ms — на маленькой
// иконке полный темп читается как задержка. Нужен className="cs-dchk" на <svg> и
// pathLength="100" на <path>.
export const dchkCss = `
.cs-dchk{display:block;transform-origin:center;opacity:0;animation:cs-dchk-in .22s ${EASE} .05s forwards,cs-dchk-rot .3s ${EASE} forwards,cs-dchk-bob .3s cubic-bezier(.34,1.35,.64,1) forwards}
.cs-dchk path{stroke-dasharray:100;stroke-dashoffset:100;animation:cs-dchk-draw .3s ${EASE} 80ms forwards}
@keyframes cs-dchk-in{from{opacity:0;filter:blur(4px)}to{opacity:1;filter:blur(0)}}
@keyframes cs-dchk-rot{from{transform:rotate(30deg)}to{transform:rotate(0)}}
@keyframes cs-dchk-bob{from{translate:0 4px}to{translate:0 0}}
@keyframes cs-dchk-draw{to{stroke-dashoffset:0}}
`;

// Skeleton reveal (transitions.dev №14, адаптация под слои разной высоты): контент
// входит из blur(2px) со сдвигом 6px вверх (.cs-skel-in), скелет доигрывает уход
// в blur поверх начала контента (.cs-skel-out, absolute) и размонтируется хуком
// SkelSwap. Оркестрацию (задержку размонтирования и мгновенный reset при повторной
// загрузке — is-resetting механика рецепта) делает компонент SkelSwap в screens/cards.
export const revealCss = `
.cs-skel-in{animation:cs-skelin .34s ease-in-out}
@keyframes cskelin{from{opacity:0;filter:blur(2px);translate:0 6px}to{opacity:1;filter:blur(0);translate:0 0}}
.cs-skel-out{animation:cs-skelout .32s ease-in-out forwards}
@keyframes cskelout{from{opacity:1}to{opacity:0;filter:blur(2px)}}
`;

// Фон top-level страниц (read/options/popup body): глубокий карбон + холодный серебристый
// radial-glow по углам + плотная плетёная текстура под 45° (углеродное волокно). Зелёный
// здесь не живёт — он только на CTA-кнопках и done-семантике. В Shadow DOM панели не применяется.
export const pageTexCss = `background-color:${BG};background-image:radial-gradient(900px 500px at 18% -5%, rgba(255,255,255,.035), transparent 60%),radial-gradient(900px 600px at 100% 110%, rgba(255,255,255,.02), transparent 60%),repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 4px);`;

// Skeuo CSS-примитивы — единый источник объёмных элементов (кнопки/карточки/inset-поля/
// badges/stages/металл). Вставляются <style> в каждый shadow-компонент и в top-level
// страницы. Канон: mockup/skeuo-variants/carbon.html (.btn/.panel/.input/.tc/.mini/.stage/.metal).
export const skeuoCss = `
.cs-btn{font:600 14px ${FONT_SANS};padding:11px 20px;border-radius:9px;border:1px solid ${BTN_BORDER};background:${BTN};color:${TEXT};cursor:pointer;text-shadow:${TXT_SHADOW};box-shadow:${SHADOW_BTN};transition:filter .12s ${EASE}, transform .06s ${EASE}, box-shadow .12s ${EASE};user-select:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;line-height:1;}
.cs-btn:hover{filter:brightness(1.12)}
.cs-btn:active{box-shadow:${SHADOW_BTN_PRESS};transform:translateY(1px);filter:brightness(.92)}
.cs-btn.filled{background:${CTA};color:${BG};border-color:${CTA_BORDER};text-shadow:0 1px rgba(255,255,255,.32)}
.cs-btn.filled:hover{filter:brightness(1.06)}
.cs-btn[disabled],.cs-btn.is-disabled{opacity:.5;cursor:not-allowed;filter:grayscale(.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px rgba(0,0,0,.5)}
.cs-btn.sm{font-size:12px;padding:7px 13px;border-radius:8px}
.cs-btn.block{width:100%}
.cs-card{background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;box-shadow:${SHADOW_CARD}}
.cs-mini{width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;background:${BTN};border:1px solid ${BTN_BORDER};color:${SEC};box-shadow:${SHADOW_BTN};cursor:pointer;line-height:0;transition:filter .12s ${EASE}, color .12s ${EASE}}
.cs-mini:hover{filter:brightness(1.15);color:${TEXT}}
.cs-mini:active{box-shadow:${SHADOW_BTN_PRESS};transform:translateY(1px)}
.cs-input{width:100%;font:500 14px ${FONT_SANS};padding:11px 13px;border-radius:9px;border:1px solid ${BORDER};background:${INPUT_BG};color:${TEXT};box-shadow:inset 0 2px 4px rgba(0,0,0,.6), inset 0 1px 0 rgba(0,0,0,.5);transition:box-shadow .12s ${EASE}, border-color .12s ${EASE}}
.cs-input::placeholder{color:${MUT}}
.cs-input:focus{outline:none;border-color:${AMBER};box-shadow:inset 0 2px 4px rgba(0,0,0,.6), 0 0 0 2px rgba(245,166,35,.55)}
.cs-tc{display:inline-flex;align-items:center;font:500 11px ${FONT_MONO};color:${BG};padding:2px 7px;border-radius:5px;border:1px solid ${AMBER_BORDER};background:${AMBER_GRAD};text-shadow:0 1px rgba(255,255,255,.3);box-shadow:${SHADOW_BADGE}}
.cs-tc.muted{color:${TEXT};background:${BTN};border-color:${BTN_BORDER};text-shadow:${TXT_SHADOW}}
.cs-stage{display:flex;align-items:center;gap:12px;padding:9px 11px;border-radius:9px;font:500 13px ${FONT_SANS};color:${MUT};background:rgba(0,0,0,.25);border:1px solid transparent;box-shadow:inset 0 1px 2px rgba(0,0,0,.45)}
.cs-stage .cs-st-ico{width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;line-height:0}
.cs-stage.done{color:${SEC}}
.cs-stage.done .cs-st-ico{background:linear-gradient(180deg,#3ec47f,#2ea66f 50%,#1f7d52);border:1px solid #145c39;color:#0d2418;box-shadow:inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.4)}
.cs-stage.active{color:${TEXT};border-color:rgba(245,166,35,.35);background:linear-gradient(180deg,rgba(245,166,35,.08),rgba(245,166,35,.03));box-shadow:inset 0 1px 2px rgba(0,0,0,.45), 0 0 0 1px rgba(245,166,35,.18)}
.cs-stage.active .cs-st-ico{background:${AMBER_RADIAL};border:1px solid ${AMBER_BORDER};box-shadow:inset 0 1px 0 rgba(255,255,255,.5), 0 0 10px rgba(245,166,35,.5)}
.cs-stage.pending .cs-st-ico{background:${BTN};border:1px solid ${BTN_BORDER};box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px rgba(0,0,0,.5)}
.cs-metal{border-radius:50%;background:${METAL_RADIAL};border:1px solid ${BG};box-shadow:inset 0 1px 0 rgba(255,255,255,.7), inset 0 -2px 3px rgba(0,0,0,.6), inset 1px 0 1px rgba(255,255,255,.22), 0 3px 7px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:filter .12s ${EASE}, transform .06s ${EASE}}
.cs-metal:hover{filter:brightness(1.08)}
.cs-metal:active{transform:translateY(1px);filter:brightness(.92)}
`;

// Видимый focus-ring для keyboard-навигации (:focus-visible — только клавиатура). !important
// перебивает inline outline:none у input'ов. Применяется глобально на каждой поверхности.
export const focusRingCss = `*:focus-visible{outline:2px solid ${AMBER}!important;outline-offset:2px;border-radius:6px;}`;

// Уважение prefers-reduced-motion: единственный источник для всех поверхностей.
// animation-iteration-count:1 глушит бесконечные анимации (spin Clogo, shim-скелетон,
// cpulse, blink-каретка, cs-scan). scroll-behavior:auto гасит smooth-scroll.
export const reducedMotionCss = `@media (prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}`;

// Chrome/Safari красят автозаполненные поля жёлтым поверх нашей палитры. Обнулить переход
// фона огромной задержкой + подменить internal box-shadow цветом инпута (INPUT_BG).
export const autofillFixCss = `input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{-webkit-text-fill-color:${TEXT}!important;-webkit-box-shadow:0 0 0 1000px ${INPUT_BG} inset!important;box-shadow:0 0 0 1000px ${INPUT_BG} inset!important;caret-color:${TEXT};transition:background-color 9999s ease-in-out 0s;}`;

// Markdown конспекта — три слоя:
//  • mdBodyCss — общие примитивы (ссылки, код, оговорка, кликабельные таймкоды .md-ts,
//     каретка стрима .md-caret). Без заголовков/списков — они зависят от экрана.
//  • panelBodyCss (.rp-body) — тело плавающей панели §07: заголовок с серебряной точкой,
//     тезисы с DIM-точкой 11.5px по SEC.
//  • readerBodyCss (.rd-body) — страница чтения §08: заголовок 16px + amber-бейдж
//     таймкода .tc, тезисы с серебряной точкой 14px по SEC.
// Заголовок «## … (MM:SS)» разбирается в lib/markdown.ts (transformSectionHeaders):
// панель — таймкод срезается (остаётся серебряная точка), reader — уходит в бейдж .tc.
export const mdBodyCss = `
.md-body p{margin:0;}
.md-body blockquote{margin:18px 0 0;padding:13px 15px;background:${INPUT_BG};border:1px solid ${LINE};border-radius:9px;box-shadow:inset 0 1px 3px rgba(0,0,0,.4);font:400 11.5px/1.55 ${FONT_SANS};color:${MUT};}
.md-body code{background:${INPUT_BG};border:1px solid ${LINE};border-radius:5px;padding:1px 5px;font:13px ${FONT_MONO};color:${SEC};}
.md-body a{color:${YT_BLUE};text-decoration:none;border-bottom:1px solid rgba(62,166,255,.3);transition:.15s ${EASE};}
.md-body a:hover{border-bottom-color:${YT_BLUE};}
.md-body .md-ts{font-family:${FONT_MONO};font-size:12.5px;color:${YT_BLUE};background:transparent;border:0;padding:0;cursor:pointer;border-bottom:1px solid transparent;transition:.15s ${EASE};white-space:nowrap;}
.md-body .md-ts:hover{border-bottom-color:${YT_BLUE};}
.md-body strong{font-weight:700;}
.md-body em{font-style:italic;}
.md-caret{display:inline-block;width:2px;height:1em;margin-left:1px;vertical-align:text-bottom;background:${AMBER};animation:clogo-blink 1s step-end infinite;}
@keyframes clogo-blink{0%,50%{opacity:1}51%,100%{opacity:0}}
`;

// §07 read-panel (.rp-body). Эталон carbon.html (.panel-body/.psec-h/.thesis).
export const panelBodyCss = `
.rp-body{font:500 12px/1.6 ${FONT_SANS};color:${TEXT};}
.rp-body>:first-child{margin-top:0;}
.rp-body .rp-sec{margin-bottom:13px;}
.rp-body h1,.rp-body h2{font:700 12.5px ${FONT_SANS};color:${TEXT};margin:0 0 6px;display:flex;align-items:center;gap:7px;}
.rp-body h1::before,.rp-body h2::before{content:"";width:5px;height:5px;border-radius:50%;background:${METAL_DOT};flex:0 0 auto;}
.rp-body h3{font:600 13px/1.3 ${FONT_SANS};color:${TEXT};margin:10px 0 4px;}
.rp-body p{margin:0;color:${SEC};font-size:11.5px;line-height:1.55;}
.rp-body ul,.rp-body ol{margin:0;padding:0;list-style:none;}
.rp-body li{position:relative;padding-left:14px;margin:0 0 4px;color:${SEC};font-size:11.5px;line-height:1.5;}
.rp-body li::before{content:"";position:absolute;left:2px;top:7px;width:4px;height:4px;border-radius:50%;background:${DIM};}
.rp-body ol{counter-reset:rpli;}
.rp-body ol li{counter-increment:rpli;}
.rp-body ol li::before{content:counter(rpli);position:absolute;left:0;top:6px;width:auto;height:auto;background:${INPUT_BG};color:${MUT};font:500 9px ${FONT_MONO};padding:0 4px;border-radius:3px;}
.rp-body strong{color:${TEXT};font-weight:700;}
/* marked заворачивает текст оговорки в <p> внутри <blockquote> — общее .rp-body p
   (11.5px/SEC) иначе перебивает приглушённый вид .md-body blockquote (MUT). */
.rp-body blockquote p{margin:0;color:inherit;font-size:inherit;line-height:inherit;}
.rp-body blockquote strong{color:inherit;}
`;

// §08 reader (.rd-body). Эталон carbon.html. h2 .tc — янтарный skeuo-бейдж (brand).
export const readerBodyCss = `
.rd-body{font:400 14px/1.65 ${FONT_SANS};color:${SEC};}
.rd-body>:first-child{margin-top:0;}
.rd-body>:last-child{margin-bottom:22px;}
.rd-body h1{font:700 22px/1.25 ${FONT_SANS};color:${TEXT};margin:0 0 14px;}
.rd-body h2{font:700 16px/1.3 ${FONT_SANS};color:${TEXT};margin:22px 0 10px;display:flex;align-items:center;gap:9px;scroll-margin-top:56px;}
.rd-body h2:first-child{margin-top:0;}
.rd-body h2 .tc{flex:0 0 auto;font:500 11px/1 ${FONT_MONO};color:${BG};background:${AMBER_GRAD};border:1px solid ${AMBER_BORDER};padding:3px 6px;border-radius:5px;display:inline-flex;align-items:center;text-shadow:0 1px rgba(255,255,255,.3);box-shadow:${SHADOW_BADGE};}
.rd-body h3{font:600 15px/1.3 ${FONT_SANS};color:${TEXT};margin:16px 0 6px;}
.rd-body p{margin:0 0 8px;color:${SEC};font-size:14px;line-height:1.65;}
.rd-body ul,.rd-body ol{margin:0;padding:0;list-style:none;}
.rd-body li{position:relative;padding-left:16px;margin:0 0 8px;color:${SEC};font:400 14px/1.65 ${FONT_SANS};}
.rd-body li::before{content:"";position:absolute;left:0;top:9px;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #ffffff, #c0c0c4 55%, #6a6a72 92%);}
.rd-body li b,.rd-body strong{color:${TEXT};font-weight:600;}
.rd-body ol{counter-reset:rdli;}
.rd-body ol li{counter-increment:rdli;}
.rd-body ol li::before{content:counter(rdli);position:absolute;left:0;top:10px;width:auto;height:auto;background:${INPUT_BG};color:${MUT};font:500 10px ${FONT_MONO};padding:0 4px;border-radius:3px;}
.rd-body blockquote{margin:26px 0 0;padding:13px 15px;background:${INPUT_BG};border:1px solid ${LINE};border-radius:9px;box-shadow:inset 0 1px 3px rgba(0,0,0,.4);font:400 11.5px/1.55 ${FONT_SANS};color:${MUT};font-style:normal;}
/* та же причина, что у .rp-body: .rd-body p (14px/SEC) иначе перебивает приглушённый
   11.5px/MUT оговорки её же собственным <p>-текстом внутри <blockquote>. */
.rd-body blockquote p{margin:0;color:inherit;font-size:inherit;line-height:inherit;}
.rd-body blockquote strong,.rd-body blockquote b{color:inherit;font-weight:inherit;}
`;
