import { z } from "zod";

const boundedInt = (min: number, max: number, fallback: number, name: string) =>
  z.string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === "") return fallback;
      const num = Number(val);
      if (Number.isNaN(num) || !Number.isInteger(num) || num < min || num > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}, got "${val}"`);
      }
      return num;
    });

const Env = z.object({
  // LLM (OpenAI-compatible). bothub.chat по умолчанию: один ключ к DeepSeek/GLM/GPT/Gemini,
  // оплата в ₽, без VPN. Подойдёт любой OpenAI-совместимый эндпоинт.
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  MAX_TOKENS: boundedInt(1, 100000, 8192, "MAX_TOKENS"),
  // REDUCE-шаг чанкинга (merge) воспроизводит все секции дословно: для длинных видео
  // это больше, чем нужно MAP-шагу. Отдельный лимит, чтобы merge не упирался в MAX_TOKENS.
  MERGE_MAX_TOKENS: boundedInt(1, 100000, 32768, "MERGE_MAX_TOKENS"),
  // 0 — таймаут отключён вовсе: IdleAbort не вооружает таймер, стрим живёт, пока
  // провайдер держит соединение. Нужно для провайдеров, молчащих десятки минут
  // на длинных транскриптах (bothub/deepseek после finish_reason=length).
  LLM_TIMEOUT_SEC: boundedInt(0, 3600, 300, "LLM_TIMEOUT_SEC"),

  // Pipeline
  MAX_DURATION_MIN: boundedInt(1, 1440, 180, "MAX_DURATION_MIN"),
  YTDLP_PROBE_TIMEOUT_SEC: boundedInt(1, 3600, 90, "YTDLP_PROBE_TIMEOUT_SEC"),
  YTDLP_DOWNLOAD_TIMEOUT_SEC: boundedInt(1, 7200, 180, "YTDLP_DOWNLOAD_TIMEOUT_SEC"),

  // Server
  PORT: boundedInt(1, 65535, 3000, "PORT"),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default(""),

  // Общий секрет между расширением и сервером. Обязателен: без него любой, кто узнал
  // адрес публичного сервера, жжёт ваш LLM-ключ. Тот же токен вводится в настройках
  // расширения.
  SHARED_TOKEN: z.string().min(24, "SHARED_TOKEN must be at least 24 characters"),

  // Rate limit — глобальная защита от сжигания LLM-ключа. Сервер знает один токен, а не
  // пользователей, поэтому лимиты общие: максимум одновременных генераций и запусков в
  // минуту (скользящее окно). Утечка токена ограничит ущерб, но не отменит его — токен
  // всё равно держим в секрете.
  RATE_LIMIT_PER_MIN: boundedInt(1, 1000, 10, "RATE_LIMIT_PER_MIN"),
  MAX_CONCURRENT_DIGESTS: boundedInt(1, 100, 2, "MAX_CONCURRENT_DIGESTS"),

  // Автообновление yt-dlp при старте (yt-dlp -U). По умолчанию выключено: обновление
  // трогает бинарник на диске и требует сеть, в Docker образ обновляется пересборкой.
  YTDLP_AUTO_UPDATE: z.string().optional().transform((v) => v === "1" || v === "true"),
});

export type Config = {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  maxTokens: number;
  mergeMaxTokens: number;
  llmTimeoutSec: number;
  maxDurationMin: number;
  ytdlpProbeTimeoutSec: number;
  ytdlpDownloadTimeoutSec: number;
  port: number;
  host: string;
  corsOrigin: string;
  sharedToken: string;
  rateLimitPerMin: number;
  maxConcurrentDigests: number;
  ytdlpAutoUpdate: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = Env.parse(env);
  return {
    llmApiKey: e.LLM_API_KEY,
    llmBaseUrl: e.LLM_BASE_URL,
    llmModel: e.LLM_MODEL,
    maxTokens: e.MAX_TOKENS,
    mergeMaxTokens: e.MERGE_MAX_TOKENS,
    llmTimeoutSec: e.LLM_TIMEOUT_SEC,
    maxDurationMin: e.MAX_DURATION_MIN,
    ytdlpProbeTimeoutSec: e.YTDLP_PROBE_TIMEOUT_SEC,
    ytdlpDownloadTimeoutSec: e.YTDLP_DOWNLOAD_TIMEOUT_SEC,
    port: e.PORT,
    host: e.HOST,
    corsOrigin: e.CORS_ORIGIN,
    sharedToken: e.SHARED_TOKEN,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    maxConcurrentDigests: e.MAX_CONCURRENT_DIGESTS,
    ytdlpAutoUpdate: e.YTDLP_AUTO_UPDATE,
  };
}
