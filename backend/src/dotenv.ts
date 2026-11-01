// A minimal .env loader without external dependencies. The format matches .env.example:
// `KEY=value` lines; empty lines and #-comments are skipped. No variable substitution,
// no nested quotes — values are read as-is.
import { readFileSync } from "node:fs";
import path from "node:path";

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    if (Object.hasOwn(out, key)) {
      // A repeated key — the last value would silently overwrite the first. This is almost
      // always a typo in .env; we warn but do not fail: value validation is the job of the
      // z-schema in config.ts.
      console.warn(`[dotenv] повторный ключ "${key}" — последнее значение перезаписывает первое`);
    }
    out[key] = val;
  }
  return out;
}

// Reads .env next to the working directory (or next to the module as a fallback) and merges
// it with process.env. Real environment variables take priority over the file — so .env
// sets the default and the environment overrides it.
export function loadEnv(moduleDir: string): Record<string, string | undefined> {
  const candidates = [path.join(process.cwd(), ".env"), path.join(moduleDir, ".env")];
  let parsed: Record<string, string> = {};
  for (const p of candidates) {
    try {
      parsed = parseDotEnv(readFileSync(p, "utf8"));
      break;
    } catch {
      // No file at this location — try the next.
    }
  }
  return { ...parsed, ...process.env };
}
