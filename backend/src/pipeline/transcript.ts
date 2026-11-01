// SRT cleaning → the transcript body. Logic ported 1:1 from clean_transcript.py (Python,
// a reference for tests only) into cleanTranscript.ts, so the runtime does not depend on Python.
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
