// Единая икон-система «Конспект»: монохромные SVG на currentColor, stroke 1.7,
// viewBox 24 (кроме монограммы-C — 64). Никаких эмодзи и типографских глифов:
// каждый значок — настоящая SVG, управляемая цветом и размером контекста.

import type { CSSProperties } from "react";

type IconProps = { size?: number; style?: CSSProperties; title?: string };

function Svg({ size = 16, style, title, strokeWidth = 1.7, linecap = "round", linejoin = "round", children }: IconProps & { strokeWidth?: number; linecap?: "round" | "butt"; linejoin?: "round" | "miter"; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={linecap}
      strokeLinejoin={linejoin}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

// Монограмма-C: кольцо с малым сектором (вырез ~63° — оптический центр совпадает с
// геометрическим). Хром-градиент. busy — статична: пульс идёт на обёртке
// (.circle-badge.busy → cpulse в теме), сама C не вращается.
// spin — отдельная опция для поверхностей с вращением (триггер на watch, feed-overlay):
// там busy-C крутится. Канонические контексты spin не передают.
export function Clogo({ size = 20, busy = false, spin = false, style }: { size?: number; busy?: boolean; spin?: boolean; style?: CSSProperties }) {
  const s = Math.max(12, size);
  return (
    <svg
      className={busy ? "clogo busy" : "clogo"}
      viewBox="0 0 64 64"
      width={s}
      height={s}
      aria-hidden="true"
      style={spin ? { ...style, animation: "clogo-spin 1.1s linear infinite", transformOrigin: "center" } : style}
    >
      <defs>
        {/* Холодное серебро: металл логотипа одной природы с кругом-триггером и точками
            секций. busy/spin — на обёртке, не в градиенте. */}
        <linearGradient id="clogo-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#f0f0f2" />
          <stop offset="48%" stopColor="#c0c0c4" />
          <stop offset="72%" stopColor="#9a9a9f" />
          <stop offset="100%" stopColor="#4a4a4f" />
        </linearGradient>
      </defs>
      <path d="M 48.5 19.5 A 21 21 0 1 0 48.5 44.5" fill="none" stroke="url(#clogo-chrome)" strokeWidth={12} />
    </svg>
  );
}

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
  </Svg>
);

// Часы для кабинета «сэкономлено» (.cab-saved): circle r9 cy12,
// стрелки M12 6v6l4 2, stroke 1.8.
export const IconClock = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6v6l4 2" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const IconError = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </Svg>
);

// Шеврон для сворачивания панели. При свёрнутом состоянии CSS rotate(180deg).
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

// Шестерёнка-«Настройки».
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.4-2-3.4-2.3 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.4 2.8a7.5 7.5 0 0 0-1.7 1l-2.3-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.4 2 3.4 2.3-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.4-2.8a7.5 7.5 0 0 0 1.7-1l2.3 1 2-3.4z" />
  </Svg>
);

// Лупа-поиск для кабинета (.cab-search). Circle + ручка.
// Здесь плоские концы (butt/miter), в отличие от часов cab-saved (round). stroke 1.8.
export const IconSearch = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.8} linecap="butt" linejoin="miter">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </Svg>
);

// Открытая книга — «Прочитать»/открыть конспект (.pop-open, .cab-read).
export const IconRead = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Svg>
);

// Квадрат — «Остановить генерацию» (панель при стриме). Простой stop-glyph.
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);

// Корзина — удалить конспект из архива.
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

// Стрелка влево — «Назад» (из читалки в архив конспектов).
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
);

// Лого YouTube — «Открыть на YouTube» иконкой (reader title, кабинет). brand-глиф.
export const IconYoutube = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.6}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </Svg>
);
