// Каталог рядом с сервером (здесь же лежат .env и, при локальной установке, бинарник
// yt-dlp). Для скомпилированного в один файл бинарника import.meta.url ведёт внутрь
// бандла, поэтому берём каталог process.execPath; для node dist/main.js execPath — это
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
