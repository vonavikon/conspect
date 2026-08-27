// Общие карточки экранов: переиспользуются панелью (ConspectPanel, Shadow DOM).
// Чистый inline-стиль + дизайн-токены, без antd — чтобы работать и в Shadow DOM панели.
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Clogo } from "../theme/icons";
import {
  AMBER,
  BG,
  CELL2,
  EASE,
  FONT_MONO,
  FONT_SANS,
  LINE,
  MUT,
  SEC,
  TEXT,
  YT_BLUE,
  focusRingCss,
  reducedMotionCss,
  scanKeyframes,
  skeuoCss,
} from "../theme/conspectTheme";

// ---------- §06 Loading: пул фактов + хуки ----------
// 16 фактов с выдумками вычищены, грамматика причёсана. [[…]] — подсветка ключевого
// фрагмента (класс .q). Разбор через сплит → React-узлы, без dangerouslySetInnerHTML:
// факты — литералы compile-time, но так безопаснее.
const LOADING_FACTS: string[] = [
  // Скорость
  "Чтение структурированного текста быстрее просмотра видео примерно в [[10 раз]].",
  "Средняя скорость речи — [[130–150]] слов в минуту. Чтение — [[200–300]].",
  "Перечитать конспект — [[несколько минут]]. Пересмотреть видео — столько же, сколько в первый раз.",
  "Скорость [[1,5–2×]] редко добавляет понимания, чаще создаёт иллюзию.",
  "Большинство выводов из видео умещаются в [[один абзац]].",
  // Контроль
  "Текст можно читать [[в тишине]]. Видео — нет.",
  "Конспект можно скормить [[ассистенту или базе знаний]].",
  // Внимание и критика
  "Частая смена кадров при монтаже снижает способность [[критически оценивать]] содержание.",
  "В тексте видны логические дыры. В видео они [[спрятаны за динамикой]].",
  "Чтение развивает внимание. Бесконечная лента его [[рассеивает]].",
  // Шум и плотность
  "Паузы, повторы и вода съедают [[до 40%]] хронометража.",
  "Длинные интро занимают [[до 5%]] видео — часы за год.",
  "Значительную часть обучающих видео можно уложить в [[три абзаца]].",
  // Польза продукта
  "Текст легко [[процитировать и передать]] — другу или в комьюнити.",
  "По конспекту видно, стоило ли видео просмотра, [[ещё до запуска]].",
  "Читать можно [[где угодно]].",
];

function renderFact(s: string): ReactNode[] {
  return s
    .split(/(\[\[[^\]]+\]\])/g)
    .filter(Boolean)
    .map((p, idx) => {
      const m = /^\[\[([^\]]+)\]\]$/.exec(p);
      return m ? (
        <span key={idx} className="lf-q">{m[1]}</span>
      ) : (
        <span key={idx}>{p}</span>
      );
    });
}

// Таймер длительности запроса «M:SS», привязанный к реальному времени старта стрима
// (startedAt из SW). Считает от startedAt, а не от mount: повторное открытие панели или
// попапа не сбрасывает счётчик. Без startedAt (до прихода снапшота) — от mount.
function useElapsed(startedAt: number | null): string {
  const mountAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t0 = startedAt ?? mountAt.current;
  const s = Math.max(0, Math.floor((now - t0) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Ротация фактов (6с на факт, как в макете). fade через opacity 300мс.
function useFact(): ReactNode {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let fade: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setShown(false);
      fade = setTimeout(() => {
        setI((v) => (v + 1) % LOADING_FACTS.length);
        setShown(true);
      }, 300);
    }, 6000);
    return () => {
      clearInterval(id);
      if (fade) clearTimeout(fade);
    };
  }, []);
  return <span style={{ opacity: shown ? 1 : 0, transition: `opacity .3s ${EASE}` }}>{renderFact(LOADING_FACTS[i])}</span>;
}

const loadingCss = `
.lf-q{color:${YT_BLUE};}
/* §06 стадии. done/active/pending — по фазам SSE, не по точным статусам бэкенда.
   Базовый объём .cs-stage/.cs-st-ico (gradient-кружок, bevel, glow, padding, inset-фон
   строки) приходит из skeuoCss. Здесь — только дополнения: спиннер active, точка pending,
   чек done поверх line-height:0 базового кружка. */
.cs-stages{display:flex;flex-direction:column;gap:7px;margin-top:2px;align-items:stretch;width:100%;}
.cs-stage{transition:color .3s ${EASE}}
.cs-stage .cs-st-ico{line-height:0}
.cs-stage.done .cs-st-ico{font:800 13px/1 ${FONT_SANS};color:#0d2418}
.cs-stage.active .cs-st-ico::after{content:"";width:8px;height:8px;border-radius:50%;background:conic-gradient(from 0deg, ${BG} 0%, ${BG} 30%, transparent 70%);animation:cs-cspin .8s linear infinite}
.cs-stage.pending .cs-st-ico::after{content:"";width:6px;height:6px;border-radius:50%;background:${MUT};opacity:.55}
@keyframes cs-cspin{to{transform:rotate(360deg)}}
@keyframes cs-factin{to{opacity:1}}
.cs-load-top{display:flex;align-items:center;gap:9px;}
.cs-load-txt{font:500 13px/1.2 ${FONT_SANS};color:${TEXT};}
.cs-load-timer{font:600 12px/1 ${FONT_MONO};color:${AMBER};background:none;border:0;padding:0;}
.cs-load-steps{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin-top:6px;}
.cs-load-steps-top{justify-content:space-between;}
.cs-load-c{position:absolute;left:0;right:0;top:0;bottom:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:0 20px;}
.cs-load-fact{position:absolute;left:0;right:0;bottom:0;padding:10px 16px 12px;text-align:center;font:500 11.5px/1.5 ${FONT_SANS};color:${SEC};border-top:1px solid ${LINE};background:rgba(15,15,15,.45);opacity:0;animation:cs-factin .6s ${EASE} 1.2s forwards;}
.cs-load-scan{position:absolute;left:0;right:0;height:60px;background:linear-gradient(180deg,transparent,rgba(245,166,35,.16),transparent);animation:cs-scan 2.6s linear infinite;}
/* Прогресс чанкинга (map-фаза длинного видео): тонкая полоса i/N под стадиями.
   Появляется с первым progress-событием бэкенда, исчезает на первом delta (сборка). */
.cs-prog{display:flex;flex-direction:column;gap:4px;margin-top:8px;width:100%;}
.cs-prog-bar{height:3px;border-radius:2px;background:${LINE};overflow:hidden;}
.cs-prog-bar i{display:block;height:100%;background:${YT_BLUE};transition:width .4s ${EASE};}
.cs-prog-txt{font:500 10px/1 ${FONT_MONO};color:${MUT};}
`;

// LoadingCard §06: загрузка живёт прямо в теле панели (§06 внутри §07) — без собственной
// рамки/фона/тени, их даёт панель. Сканлайн/стадии/таймер/факт — те же. phase — эвристика
// по фазам SSE: 0 (до meta — «Скачиваю субтитры»), 1 (meta — «Анализирую»), 2 (пошёл delta —
// «Собираю конспект»). Бэкенд не сообщает точные статусы, поэтому стадии — индикатор по
// событиям потока, не реальный прогресс этапов.
export const STAGES = ["Скачиваю субтитры", "Анализирую", "Собираю конспект"];

// Общий блок прогресса чанкинга: тонкая полоса + «Фрагмент i из N». n<=1 — короткое
// видео без чанков, полоса не нужна. Бэкенд шлёт progress в map-фазе; на первом delta
// SW обнуляет его — полоса уходит, стадии переключаются на «Собираю конспект».
function ProgressLine({ progress }: { progress?: { i: number; n: number } | null }) {
  if (!progress || progress.n <= 1 || progress.i < 1) return null;
  const pct = Math.min(100, Math.round((progress.i / progress.n) * 100));
  return (
    <div className="cs-prog">
      <div className="cs-prog-bar"><i style={{ width: `${pct}%` }} /></div>
      <span className="cs-prog-txt">Фрагмент {progress.i} из {progress.n} · {pct}%</span>
    </div>
  );
}

export function LoadingCard({ phase = 0, startedAt = null, progress = null }: { phase?: 0 | 1 | 2; startedAt?: number | null; progress?: { i: number; n: number } | null }) {
  const elapsed = useElapsed(startedAt);
  const fact = useFact();
  const rootStyle: CSSProperties = { width: "100%", height: "100%", minHeight: 340, background: "transparent", border: "none", borderRadius: 0, overflow: "hidden", position: "relative", boxShadow: "none" };
  return (
    <>
      <style>{`${skeuoCss}${focusRingCss}${reducedMotionCss}${loadingCss}${scanKeyframes}`}</style>
      <div
        className="cs-load-card"
        role="status"
        aria-live="polite"
        aria-label="Готовлю конспект"
        style={rootStyle}
      >
        <div className="cs-load-scan" />
        <div className="cs-load-c">
          <div className="cs-load-top">
            <Clogo size={30} busy />
          </div>
          <div className="cs-load-steps">
            <div className="cs-load-top cs-load-steps-top">
              <span className="cs-load-txt">Готовлю Conspect…</span>
              <span className="cs-load-timer">{elapsed}</span>
            </div>
            <div className="cs-stages">
              {STAGES.map((label, i) => {
                const st = i < phase ? "done" : i === phase ? "active" : "pending";
                return (
                  <div key={label} className={`cs-stage ${st}`} aria-current={st === "active" ? "step" : undefined}>
                    <span className="cs-st-ico">{st === "done" ? "✓" : null}</span>
                    {label}
                  </div>
                );
              })}
            </div>
            <ProgressLine progress={progress} />
          </div>
        </div>
        <div className="cs-load-fact">
          {fact}
        </div>
      </div>
    </>
  );
}

// LoadingInline: тот же контент (таймер, 3 стадии, ротация фактов), но без карточной
// обёртки — в нормальном потоке. Для попапа при генерации по ссылке: loading живёт прямо
// в pop-body, без «рамки в рамке». Без Clogo в заголовке — в попапе он уже виден в шапке.
// Переиспользует loadingCss (.cs-stage/.cs-load-*) из LoadingCard.
export function LoadingInline({ phase = 0, startedAt = null, progress = null }: { phase?: 0 | 1 | 2; startedAt?: number | null; progress?: { i: number; n: number } | null }) {
  const elapsed = useElapsed(startedAt);
  const fact = useFact();
  return (
    <>
      <style>{`${skeuoCss}${focusRingCss}${reducedMotionCss}${loadingCss}`}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9 }}>
          <span style={{ font: `500 13px/1.2 ${FONT_SANS}`, color: TEXT }}>Готовлю Conspect…</span>
          <span style={{ font: `600 12px/1 ${FONT_MONO}`, color: AMBER }}>{elapsed}</span>
        </div>
        <div className="cs-stages">
          {STAGES.map((label, i) => {
            const st = i < phase ? "done" : i === phase ? "active" : "pending";
            return (
              <div key={label} className={`cs-stage ${st}`} aria-current={st === "active" ? "step" : undefined}>
                <span className="cs-st-ico">{st === "done" ? "✓" : null}</span>
                {label}
              </div>
            );
          })}
        </div>
        <ProgressLine progress={progress} />
        <div style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, borderTop: `1px solid ${LINE}`, paddingTop: 9, textAlign: "center" }}>
          {fact}
        </div>
      </div>
    </>
  );
}

// ---------- Skeleton ----------
// Шиммер-плейсхолдер для загрузки кабинета/чтения: серые блоки с проходом-бликом
// (вместо текста «Загрузка…»). rows — высоты строк (px); первая/последняя у́же, чтобы
// повторять форму реального контента. <style> на экземпляр — дубли безвредны.
const skCss = `
.cs-sk{position:relative;overflow:hidden;background:${CELL2};border-radius:6px;}
.cs-sk::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);
  animation:cs-shim 1.3s ${EASE} infinite;}
@keyframes cs-shim{to{transform:translateX(100%)}}
`;
export function Skeleton({ rows }: { rows: number[] }) {
  return (
    <>
      <style>{skCss}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map((h, i) => {
          const w = i === 0 ? "58%" : i === rows.length - 1 ? "72%" : "100%";
          return <div key={i} className="cs-sk" style={{ height: h, width: w }} />;
        })}
      </div>
    </>
  );
}
