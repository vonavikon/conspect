// Сборка расширения: background (ESM, service worker module) + content/options (IIFE).
// esbuild собирает каждый entry отдельно. Статику (manifest, html) копируем в dist/.
// CWD-agnostic: все пути относительно этого файла.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

// background — без UI (.ts, ESM service worker), content/options/popup/read — React (.tsx).
const entries = [
  { entry: "src/background.ts", outfile: "dist/background.js", format: "esm" },
  { entry: "src/content.tsx", outfile: "dist/content.js", format: "iife" },
  { entry: "src/options.tsx", outfile: "dist/options.js", format: "iife" },
  { entry: "src/popup.tsx", outfile: "dist/popup.js", format: "iife" },
  { entry: "src/read.tsx", outfile: "dist/read.js", format: "iife" },
  { entry: "src/offscreen.ts", outfile: "dist/offscreen.js", format: "iife" },
];

const base = (e) => ({
  entryPoints: [resolve(HERE, e.entry)],
  bundle: true,
  outfile: resolve(HERE, e.outfile),
  absWorkingDir: HERE,
  format: e.format,
  // React 18 automatic runtime: esbuild подтягивает react/jsx-runtime.
  jsx: "automatic",
  target: "chrome120",
  platform: "browser",
  // woff2 из @fontsource-* инлайнятся как data: URL — self-hosted шрифты без
  // запросов к Google. В @font-face (src/lib/fonts.ts) url(${dataUrl}).
  loader: { ".woff2": "dataurl" },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
});

// Кнопка и панель живут в Shadow DOM, стили — через antd cssinjs. content.css не нужен.
const STATIC = ["manifest.json", "src/options.html", "src/popup.html", "src/read.html", "src/offscreen.html"];
const copyStatic = () => {
  mkdirSync(resolve(HERE, "dist"), { recursive: true });
  for (const f of STATIC) {
    const src = resolve(HERE, f);
    const out = resolve(HERE, "dist", f.replace(/^src\//, ""));
    cpSync(src, out);
  }
  // icons/ (PNG action/store-иконки) — целиком в dist/icons/.
  cpSync(resolve(HERE, "icons"), resolve(HERE, "dist/icons"), { recursive: true });
  // config.json (опционально): адрес сервера + общий токен. Его кладёт агент при установке
  // (или install-скрипт). Файл в .gitignore — токен не должен попасть в репозиторий.
  const cfgJson = resolve(HERE, "config.json");
  if (existsSync(cfgJson)) cpSync(cfgJson, resolve(HERE, "dist", "config.json"));
};

if (watch) {
  for (const e of entries) {
    const ctx = await context(base(e));
    await ctx.watch();
  }
  console.log("watching…");
} else {
  rmSync(resolve(HERE, "dist"), { recursive: true, force: true });
  for (const e of entries) await build(base(e));
  copyStatic();
  console.log("build → dist/");
}
