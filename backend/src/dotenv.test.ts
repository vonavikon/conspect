import { describe, expect, it, vi } from "vitest";
import { parseDotEnv } from "./dotenv.js";

describe("parseDotEnv", () => {
  it("читает KEY=VALUE, пропускает пустые и комментарии", () => {
    expect(parseDotEnv("A=1\n\n# comment\nB=hello world\n")).toEqual({
      A: "1",
      B: "hello world",
    });
  });

  it("снимает парные кавычки, но не трогает значение без них", () => {
    expect(parseDotEnv('X="a b"\nY=plain\nZ=\'c\'\n')).toEqual({
      X: "a b",
      Y: "plain",
      Z: "c",
    });
  });

  it("игнорирует строки без = и с пустым ключом", () => {
    expect(parseDotEnv("garbage\n=val\n=bad\nK=\n")).toEqual({ K: "" });
  });

  it("перезаписывает повторный ключ и предупреждает", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseDotEnv("A=1\nA=2\n")).toEqual({ A: "2" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
