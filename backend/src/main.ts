import { execFile } from "node:child_process";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { loadEnv } from "./dotenv.js";
import { runtimeDir } from "./runtime.js";
import { createYoutube, resolveYtdlpBin } from "./pipeline/youtube.js";
import { createTranscript } from "./pipeline/transcript.js";
import { createLlm } from "./pipeline/llm.js";
import { createOrchestrator } from "./pipeline/orchestrator.js";
import { createApp } from "./api.js";

const here = runtimeDir();
const cfg = loadConfig(loadEnv(here));

const youtube = createYoutube({ probeTimeoutSec: cfg.ytdlpProbeTimeoutSec, downloadTimeoutSec: cfg.ytdlpDownloadTimeoutSec, ytdlpBin: resolveYtdlpBin(here) });
const transcript = createTranscript();
const llm = createLlm({
  baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey,
  model: cfg.llmModel, maxTokens: cfg.maxTokens, mergeMaxTokens: cfg.mergeMaxTokens, timeoutSec: cfg.llmTimeoutSec,
});
const orchestrator = createOrchestrator({ youtube, transcript, llm, maxDurationMin: cfg.maxDurationMin });

const app = createApp({ cfg, orchestrator });

// yt-dlp auto-update at startup (optional, YTDLP_AUTO_UPDATE=1). It does not block
// startup: this is a background task. yt-dlp -U downloads a fresh binary over the current one;
// probe/download already pass --no-update, so yt-dlp does not touch the network at runtime.
if (cfg.ytdlpAutoUpdate) {
  const bin = resolveYtdlpBin(here);
  execFile(bin, ["-U"], { timeout: 120_000 }, (err, stdout) => {
    if (err) console.error(`[yt-dlp] auto-update failed: ${err.message}`);
    else console.log(`[yt-dlp] auto-update: ${stdout.trim().split("\n").at(-1) ?? "ok"}`);
  });
}

serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  console.log(`conspect-backend on :${info.port}`);
});
