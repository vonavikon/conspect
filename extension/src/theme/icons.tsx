// The unified "Conspect" icon system: monochrome SVGs on currentColor, stroke 1.7,
// viewBox 24 (except the C monogram — 64). No emoji or typographic glyphs:
// every glyph is a real SVG, driven by the context's color and size.

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

// The C monogram: a ring with a small sector (a ~63° cut — the optical center matches
// the geometric one). Chrome gradient. busy — static: the pulse runs on the wrapper
// (.circle-badge.busy = cpulse in the theme); the C itself does not rotate.
// spin — a separate option for surfaces outside the canon (the watch trigger, the feed overlay):
// there the busy-C spins. Canonical contexts do not pass spin.
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
        {/* Cold silver: the logo's metal is of the same nature as the trigger circle and the
            section dots (.clogo/.metal radial). busy/spin animates on the wrapper, not in the gradient. */}
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

// Clock for the dashboard's cab-saved: circle r9 cy12, hands M12 6v6l4 2, stroke 1.8.
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

// Chevron for collapsing the panel. When collapsed, CSS rotate(180deg).
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

// The "dashboard" icon — a person silhouette (head + shoulders). Replaces the gear
// in the popup header: the options page became an archive dashboard, not a technical config.
export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);

// Search magnifier for the dashboard (.cab-search). Circle + handle.
// The canon does not set stroke-linecap/linejoin → flat ends (butt/miter), unlike
// the cab-saved clock (round). stroke 1.8.
export const IconSearch = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.8} linecap="butt" linejoin="miter">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </Svg>
);

// An open book — "Read"/open the digest (.pop-open, .cab-read).
export const IconRead = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Svg>
);

// A square — "Stop generation" (the panel while streaming). A plain stop glyph.
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);

// Trash — delete a digest from the archive.
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

// A left arrow — "Back" (from the reader to the digest archive).
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
);

// A circular arrow — "Refresh" (popup: re-read the connection status and "Recent").
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);

// Drag handle (6 dots) — reorder the dashboard queue.
export const IconGrip = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

// The YouTube logo — "Open on YouTube" as an icon (reader title, dashboard). Brand glyph.
export const IconYoutube = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.6}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </Svg>
);
