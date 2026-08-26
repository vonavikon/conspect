// Чистка SRT → тело транскрипта. Раньше звала clean_transcript.py через subprocess
// (python3 + скрипт рядом с бинарником). Для self-host-сборки в один .exe Python-зависимость
// убрана: логика портирована в cleanTranscript.ts (1:1 с Python-версией).
import { readFile } from "node:fs/promises";
import { cleanTranscript } from "./cleanTranscript.js";

type CleanArgs = {
  srtPath: string;
  outPath: string;
  title: string;
  source: string;
  channel: string;
  duration: string;
  lang: string;
};

export function createTranscript() {
  return {
    async clean(a: CleanArgs): Promise<string> {
      const raw = await readFile(a.srtPath, "utf8");
      return cleanTranscript(raw).trim();
    },
  };
}
