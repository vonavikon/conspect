import { describe, it, expect } from "vitest";
import {
  fmtDuration,
  fileName,
  wrapFrontmatter,
  REASON_TEXT,
} from "../src/panel/format";

describe("fmtDuration", () => {
  it("возвращает «—» для пустого/нулевого/отрицательного", () => {
    expect(fmtDuration(undefined)).toBe("—");
    expect(fmtDuration(0)).toBe("—");
    expect(fmtDuration(-5)).toBe("—");
  });

  it("форматирует секунды в M:SS", () => {
    expect(fmtDuration(5)).toBe("0:05");
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(60)).toBe("1:00");
    expect(fmtDuration(3599)).toBe("59:59");
  });

  it("переключается на H:MM:SS от 1 часа", () => {
    expect(fmtDuration(3600)).toBe("1:00:00");
    expect(fmtDuration(3725)).toBe("1:02:05");
    expect(fmtDuration(36000)).toBe("10:00:00");
  });
});

describe("fileName", () => {
  it("фолбэк conspect.md для пустого названия", () => {
    expect(fileName(undefined)).toBe("conspect.md");
    expect(fileName("")).toBe("conspect.md");
    expect(fileName("   ")).toBe("conspect.md");
  });

  it("сохраняет кириллицу, латиницу, цифры, дефис, подчёркивание", () => {
    expect(fileName("Архитектура агентных систем")).toBe(
      "Архитектура агентных систем.md",
    );
    expect(fileName("a_b-c")).toBe("a_b-c.md");
    expect(fileName("Тест 100")).toBe("Тест 100.md");
  });

  it("выбрасывает знаки препинания и спецсимволы", () => {
    // # : / удаляются, пробелы остаются
    expect(fileName("Lec #1: A/B")).toBe("Lec 1 AB.md");
    expect(fileName("Тема (N) [часть 2]")).toBe("Тема N часть 2.md");
  });

  it("обрезает до 60 символов", () => {
    const long = "А".repeat(80);
    const out = fileName(long);
    expect(out.length).toBe(60 + ".md".length);
    expect(out.startsWith("А".repeat(60))).toBe(true);
  });
});

describe("wrapFrontmatter", () => {
  it("собирает frontmatter из полной меты и дописывает тело", () => {
    const out = wrapFrontmatter(
      {
        meta: { title: "Тема", channel: "Канал", durationSec: 120, lang: "ru" },
        conspectus: "тело",
      },
      "https://youtube.com/watch?v=1",
    );
    expect(out.startsWith('---\nsource: "https://youtube.com/watch?v=1"\n')).toBe(
      true,
    );
    expect(out).toContain('title: "Тема"');
    expect(out).toContain('channel: "Канал"');
    expect(out).toContain("duration: 2:00");
    expect(out).toContain("lang: ru");
    expect(out).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    expect(out.endsWith("---\nтело")).toBe(true);
  });

  it("пустая мета → заглушки, длительность «—»", () => {
    const out = wrapFrontmatter({ meta: {}, conspectus: "" }, "u");
    expect(out).toContain('title: ""');
    expect(out).toContain("duration: —");
    expect(out).toContain("lang: ");
    expect(out.endsWith("---\n")).toBe(true);
  });
});

describe("REASON_TEXT", () => {
  const EXPECTED_KEYS = [
    "invalid_url",
    "too_long",
    "no_captions",
    "empty_transcript",
    "unavailable",
    "conspectus_failed",
    "not_configured",
    "http_error",
    "exception",
    "no_content",
    "stream_closed",
  ] as const;

  it("содержит все ожидаемые reason-ключи", () => {
    for (const k of EXPECTED_KEYS) {
      expect(REASON_TEXT[k], `ключ ${k}`).toBeTruthy();
    }
  });

  it("значения — непустые строки", () => {
    for (const k of EXPECTED_KEYS) {
      expect(typeof REASON_TEXT[k]).toBe("string");
      expect((REASON_TEXT[k] as string).length).toBeGreaterThan(0);
    }
  });

  // Каноничные формулировки, которые видит пользователь. Тест сверяется с актуальными
  // строками, а не с устаревшей копией — так легко ловить расхождение текста.
  it("каноничные формулировки", () => {
    expect(REASON_TEXT.invalid_url).toBe("Неправильная ссылка.");
    expect(REASON_TEXT.too_long).toBe(
      "Видео слишком длинное. Я могу сделать конспект только для видео до 3 часов.",
    );
    expect(REASON_TEXT.no_captions).toBe(
      "К сожалению, для этого видео конспект невозможен.",
    );
    expect(REASON_TEXT.empty_transcript).toBe(
      "К сожалению, для этого видео конспект невозможен.",
    );
    expect(REASON_TEXT.unavailable).toBe("Видео недоступно.");
    expect(REASON_TEXT.conspectus_failed).toBe(
      "Не получилось собрать конспект. Попробуйте ещё раз.",
    );
    expect(REASON_TEXT.not_configured).toBe(
      "Сервер не настроен. Добавьте файл config.json в папку расширения и перезагрузите его.",
    );
    expect(REASON_TEXT.http_error).toBe("Сервис конспектов недоступен. Попробуйте позже.");
    expect(REASON_TEXT.exception).toBe("Не получилось связаться с сервисом. Попробуйте ещё раз.");
    expect(REASON_TEXT.no_content).toBe("Не слышу речи в видео.");
    expect(REASON_TEXT.stream_closed).toBe("Соединение прервалось. Попробуйте ещё раз.");
  });

  // Пользователь не должен видеть системные маркеры: english error-codes, reason-ключи,
  // HTTP-статусы, вопросительные знаки-заглушки. Регресс на T45c/T45d.
  it("без системных маркеров (error/reason/status/english)", () => {
    const FORBIDDEN = [
      "error:",
      "reason",
      "unknown",
      "undefined",
      "null",
      "http",
      "status",
      "(?",
      "NaN",
    ];
    for (const k of EXPECTED_KEYS) {
      const v = (REASON_TEXT[k] as string).toLowerCase();
      for (const bad of FORBIDDEN) {
        expect(v, `${k} содержит «${bad}»`).not.toContain(bad);
      }
    }
  });
});
