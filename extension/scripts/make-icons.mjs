// Render logos/icons from icons/logo.svg into 16/32/48/128 PNGs — for action.default_icon
// and the icons in the manifest (MV3 requires raster; SVG is not supported). density 384 gives
// sharp edges at 16px. Run: node scripts/make-icons.mjs (after `npm i -D sharp`).
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
