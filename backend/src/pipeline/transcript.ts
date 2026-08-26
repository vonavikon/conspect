// Чистка SRT → тело транскрипта. Логика портирована 1:1 из clean_transcript.py (Python,
// только эталон для тестов) в cleanTranscript.ts, чтобы рантайм не зависел от Python.
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
