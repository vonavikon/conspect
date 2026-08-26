// Golden-тест: порт cleanTranscript.ts должен давать байт-в-байт тот же результат,
// что и clean_transcript.py в режиме --no-frontmatter. Сверка идёт с реальным Python
// (если он есть в PATH), иначе — с зафиксированным golden-текстом.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTranscript, fmtTs, parseSrtBlocks, parseTiming } from "./cleanTranscript.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pyPath = path.resolve(here, "../../clean_transcript.py");

// Фикстура покрывает: rolling-overlap («это тест» — хвост блока 1, повтор в блоке 2),
// сущности (&amp;), пробелы перед пунктуацией (« . », « , » и « (»), переход через
// окно 60с и тайминг > 1 часа (H:MM:SS).
const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "привет это тест",
  "",
  "2",
  "00:00:03,000 --> 00:00:06,000",
  "это тест второй блок (продолжение)",
  "",
  "3",
  "00:01:05,000 --> 00:01:08,000",
  "через минуту новый параграф . да &amp; нет",
  "",
  "4",
  "01:00:00,000 --> 01:00:03,000",
  "час позже , ещё текст",
  "",
].join("\n");

const GOLDEN = [
  "[00:01] привет это тест второй блок(продолжение)",
  "",
  "[01:05] через минуту новый параграф. да & нет",
  "",
  "[1:00:00] час позже, ещё текст",
].join("\n");

function runPython(srt: string): string | null {
  const dir = mkdtempSync(path.join(tmpdir(), "ct-"));
  const srtPath = path.join(dir, "in.srt");
  try {
    writeFileSync(srtPath, srt, "utf8");
    const out = execFileSync(
      process.env.PYTHON_BIN ?? "python3",
      [pyPath, "--srt", srtPath, "--no-frontmatter"],
      { encoding: "utf8" },
    );
    // Python-print на Windows отдаёт CRLF; нормируем к LF как в TS-порту.
    return out.replace(/\r\n/g, "\n").replace(/\n$/, "");
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("cleanTranscript (порт clean_transcript.py)", () => {
  it("fmtTs форматирует секунды", () => {
    expect(fmtTs(65)).toBe("01:05");
    expect(fmtTs(3660)).toBe("1:01:00");
    expect(fmtTs(0)).toBe("00:00");
  });

  it("parseTiming читает start из строки тайминга", () => {
    expect(parseTiming("00:01:23,400 --> 00:01:25,000")).toBe(83);
    expect(parseTiming("not timing")).toBeNull();
  });

  it("parseSrtBlocks убирает индекс/тайминг и дешифрует сущности", () => {
    const blocks = parseSrtBlocks(SRT);
    expect(blocks[0]).toEqual([1, "привет это тест"]);
    expect(blocks[1][0]).toBe(3);
    expect(blocks[2][1]).toContain("& нет");
  });

  it("toParagraphs даёт golden-вывод", () => {
    expect(cleanTranscript(SRT)).toBe(GOLDEN);
  });

  it("совпадает с clean_transcript.py", () => {
    const py = runPython(SRT);
    const ts = cleanTranscript(SRT);
    if (py === null) {
      // Python нет — сверяем с зафиксированным golden.
      expect(ts).toBe(GOLDEN);
      return;
    }
    expect(ts).toBe(py);
  });
});
