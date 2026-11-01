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
  // LLM (OpenAI-compatible). bothub.chat by default: one key for DeepSeek/GLM/GPT/Gemini,
  // payment in ₽, no VPN. Any OpenAI-compatible endpoint works.
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  MAX_TOKENS: boundedInt(1, 100000, 8192, "MAX_TOKENS"),
  // The chunking REDUCE step (merge) reproduces all sections verbatim: for long videos
  // that is more than the MAP step needs. A separate limit so merge does not hit MAX_TOKENS.
  MERGE_MAX_TOKENS: boundedInt(1, 100000, 32768, "MERGE_MAX_TOKENS"),
  // 0 — the timeout is disabled entirely: IdleAbort does not arm the timer; the stream lives
  // as long as the provider holds the connection. Needed for providers that stay silent for
  // tens of minutes on long transcripts (bothub/deepseek after finish_reason=length).
  LLM_TIMEOUT_SEC: boundedInt(0, 3600, 300, "LLM_TIMEOUT_SEC"),

  // Pipeline
  MAX_DURATION_MIN: boundedInt(1, 1440, 180, "MAX_DURATION_MIN"),
  YTDLP_PROBE_TIMEOUT_SEC: boundedInt(1, 3600, 90, "YTDLP_PROBE_TIMEOUT_SEC"),
  YTDLP_DOWNLOAD_TIMEOUT_SEC: boundedInt(1, 7200, 180, "YTDLP_DOWNLOAD_TIMEOUT_SEC"),

  // Server
  PORT: boundedInt(1, 65535, 3000, "PORT"),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default(""),

  // Shared secret between the extension and the server. Mandatory: without it, anyone who
  // learned the public server's address burns your LLM key. The same token is entered in
  // the extension settings.
  SHARED_TOKEN: z.string().min(24, "SHARED_TOKEN must be at least 24 characters"),

  // Rate limit — global protection against burning the LLM key. The server knows one token,
  // not users, so the limits are shared: max concurrent generations and starts per
  // minute (sliding window). A token leak limits the damage but does not cancel it — keep
  // the token secret anyway.
  RATE_LIMIT_PER_MIN: boundedInt(1, 1000, 10, "RATE_LIMIT_PER_MIN"),
  MAX_CONCURRENT_DIGESTS: boundedInt(1, 100, 2, "MAX_CONCURRENT_DIGESTS"),

  // yt-dlp auto-update at startup (yt-dlp -U). Off by default: updating touches the
  // on-disk binary and needs the network; in Docker the image is updated by rebuild.
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
