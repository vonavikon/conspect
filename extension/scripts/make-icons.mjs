// Рендер logos/icons из icons/logo.svg в PNG 16/32/48/128 — для action.default_icon
// и icons в manifest (MV3 требует raster, SVG не поддерживается). density 384 даёт
// чёткие края на 16px. Запуск: node scripts/make-icons.mjs (после `npm i -D sharp`).
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const svg = await readFile(resolve(HERE, "../icons/logo.svg"));

for (const s of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 })
    .resize(s, s)
    .png()
    .toFile(resolve(HERE, `../icons/icon-${s}.png`));
  console.log(`icons/icon-${s}.png`);
}
