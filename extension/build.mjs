// Extension build: background (ESM, service worker module) + content/options (IIFE).
// esbuild bundles each entry separately. Static files (manifest, html) are copied to dist/.
// CWD-agnostic: all paths are relative to this file.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

// background — no UI (.ts, ESM service worker); content/options/popup/read — React (.tsx).
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
  // React 18 automatic runtime: esbuild pulls in react/jsx-runtime.
  jsx: "automatic",
  target: "chrome120",
  platform: "browser",
  // woff2 from @fontsource-* is inlined as data: URLs — self-hosted fonts without
  // requests to Google. In @font-face (src/lib/fonts.ts) url(${dataUrl}).
  loader: { ".woff2": "dataurl" },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
});

// The button and panel live in Shadow DOM; styles — via antd cssinjs. No content.css needed.
const STATIC = ["manifest.json", "src/options.html", "src/popup.html", "src/read.html", "src/offscreen.html"];
const copyStatic = () => {
  mkdirSync(resolve(HERE, "dist"), { recursive: true });
  for (const f of STATIC) {
    const src = resolve(HERE, f);
    const out = resolve(HERE, "dist", f.replace(/^src\//, ""));
    cpSync(src, out);
  }
  // icons/ (PNG action/store icons) — copied whole into dist/icons/.
  cpSync(resolve(HERE, "icons"), resolve(HERE, "dist/icons"), { recursive: true });
  // config.json (optional): server address + shared token. Placed by the install agent
  // (or the install script). The file is in .gitignore — the token must not reach the repo.
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
