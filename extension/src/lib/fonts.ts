// Self-hosted fonts (E1): woff2 files are inlined by esbuild as data: URLs — not a
// single request to fonts.googleapis.com/gstatic (privacy + no dependency on YouTube's
// style-src CSP). Cyrillic (U+0400-045F) covers Rus./Ukr./Bel.; latin — ASCII, digits,
// punctuation. Families — 'Onest'/'PT Mono' (without 'Variable'), as conspectTheme expects.
import onestCyr from "@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2";
import onestLatin from "@fontsource-variable/onest/files/onest-latin-wght-normal.woff2";
import ptCyr from "@fontsource/pt-mono/files/pt-mono-cyrillic-400-normal.woff2";
import ptLatin from "@fontsource/pt-mono/files/pt-mono-latin-400-normal.woff2";

const CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
const LAT = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

const FONTS_CSS = `
@font-face{font-family:'Onest';font-style:normal;font-display:swap;font-weight:100 900;src:url(${onestCyr}) format('woff2-variations');unicode-range:${CYR};}
@font-face{font-family:'Onest';font-style:normal;font-display:swap;font-weight:100 900;src:url(${onestLatin}) format('woff2-variations');unicode-range:${LAT};}
@font-face{font-family:'PT Mono';font-style:normal;font-display:swap;font-weight:400;src:url(${ptCyr}) format('woff2');unicode-range:${CYR};}
@font-face{font-family:'PT Mono';font-style:normal;font-display:swap;font-weight:400;src:url(${ptLatin}) format('woff2');unicode-range:${LAT};}
`;

const FONTS_STYLE_ID = "conspect-fonts";

// Inject a <style> into document.head. Fonts are document-global — the panel's Shadow DOM
// applies them by font-family. Idempotent (by id).
export function injectFonts(): void {
  if (document.getElementById(FONTS_STYLE_ID)) return;
  if (!document.head) return;
  const el = document.createElement("style");
  el.id = FONTS_STYLE_ID;
  el.textContent = FONTS_CSS;
  document.head.appendChild(el);
}
