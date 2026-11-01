// The directory next to the server (.env lives here, and the yt-dlp binary for a local
// install). For a single-file compiled binary, import.meta.url points inside the
// bundle, so we take the directory of process.execPath; for node dist/main.js execPath is
// node.exe, and then we use import.meta.url.
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runtimeDir(): string {
  const exe = process.execPath;
  if (exe && /\.(exe|bin)$/i.test(exe) && !/node/i.test(exe)) {
    return path.dirname(exe);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}
