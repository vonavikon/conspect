// Минимальный загрузчик .env без внешних зависимостей (для сборки в один .exe через
// Bun нельзя тянуть dotenv из node_modules). Формат совпадает с .env.example и
// install.ps1/install.sh: строки `KEY=value`, пустые и `#`-комментарии пропускаются.
// Без подстановки переменных и вложенных кавычек — значения читаются as-is.
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
      // Повторный ключ — последнее значение молча перезаписывало бы первое. Это почти
      // всегда опечатка в .env, предупреждаем, но не падаем: валидация значений — дело
      // z-схемы в config.ts.
      console.warn(`[dotenv] повторный ключ "${key}" — последнее значение перезаписывает первое`);
    }
    out[key] = val;
  }
  return out;
}

// Читает .env рядом с рабочим каталогом (или рядом с модулем как фолбэк) и сливает
// с process.env. Реальные переменные окружения имеют приоритет над файлом — так .env
// задаёт дефолт, а окружение переопределяет его.
export function loadEnv(moduleDir: string): Record<string, string | undefined> {
  const candidates = [path.join(process.cwd(), ".env"), path.join(moduleDir, ".env")];
  let parsed: Record<string, string> = {};
  for (const p of candidates) {
    try {
      parsed = parseDotEnv(readFileSync(p, "utf8"));
      break;
    } catch {
      // Нет файла в этом месте — пробуем следующее.
    }
  }
  return { ...parsed, ...process.env };
}
