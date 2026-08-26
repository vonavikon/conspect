// Каталог, где лежат .env и yt-dlp.exe рядом с сервером. Для self-host .exe (Bun
// compile) import.meta.url ведёт внутрь бандла, а не в папку бинарника — поэтому
// ориентируемся на process.execPath. Для node dist/main.js execPath указывает на
// node.exe, тогда берём import.meta.url.
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runtimeDir(): string {
  const exe = process.execPath;
  if (exe && /\.(exe|bin)$/i.test(exe) && !/node/i.test(exe)) {
    return path.dirname(exe);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}
