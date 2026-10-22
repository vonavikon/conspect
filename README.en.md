# Conspect

[RU](README.md) · **EN** · [中文](README.zh.md) · [Español](README.es.md) · [Français](README.fr.md)

![Конспект собирается потоком: субтитры, анализ, структурированный конспект](docs/conspect-demo.gif)

YouTube summaries in one click. A Chrome extension starts building a structured summary of a video on your server: the server downloads the subtitles, cleans the transcript, and streams the summary back. The extension is a thin client: a button under the player, a live preview as the text is generated, export to Markdown.

Self-hosted: no accounts, no payments, no database. The server stores nothing. The finished summary is cached in the browser and saved as `.md`.

## Architecture

- `backend/` — Node server on Hono (TypeScript). Subtitle download and LLM summarization run entirely on the server.
- `extension/` — Chrome MV3 extension. It reads the server address and access password from `config.json`; there are no server settings in the UI.

The summary is built in four steps: yt-dlp downloads the subtitles, `cleanTranscript.ts` cleans the transcript, an LLM writes the summary, and the server streams the text to the extension over SSE.

## Requirements

- Node.js 20+.
- yt-dlp in PATH (either next to the server, or a path via `YTDLP_BIN`).
- Python is not needed to run it. It is only needed to run the transcript-cleaning tests, which compare `cleanTranscript.ts` against the reference `clean_transcript.py`. Without Python, the test compares against a recorded text.

## Deployment

Three scenarios. Choose based on where the summaries will run and which devices need access.

| Scenario | Server | Access | Good for |
|---|---|---|---|
| Local | your computer | `localhost` | trying it out; a single computer |
| Own VPS + SSH tunnel | server | `localhost` via ssh | you want a running server but don't want to expose it to the internet |
| Public address | server | `https://your-domain` | several devices; needs a domain and HTTPS |

### Local

Docker:

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health   # {"ok":true,"version":"1"}
```

Without Docker:

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
npm install
npm run build
npm start
```

yt-dlp must be in PATH: `pip install yt-dlp`, or a binary from the yt-dlp releases. You can also set the path explicitly via `YTDLP_BIN`.

In the extension's `config.json`, keep `baseUrl` set to `http://localhost:3000`.

### Own VPS + SSH tunnel

The backend port stays bound to `127.0.0.1` on the server, so it is closed from the outside. Your computer reaches it over ssh. No ports to open, no certificates to issue: ssh itself provides the encryption.

On the server:

```bash
git clone https://github.com/vonavikon/conspect.git
cd conspect/backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

On your computer:

```bash
ssh -N -L 3000:localhost:3000 user@your-server
```

While this command runs, `http://localhost:3000` on your computer is the backend on the server. The `baseUrl` in the extension's `config.json` stays `http://localhost:3000`.

To have the tunnel come up on its own at login and survive connection drops, use the ready-made scripts: [`scripts/tunnel/`](scripts/tunnel/) (Windows, Linux, macOS).

If port 3000 on the server is taken by something else, change the mapping in `docker-compose.yml` (`"127.0.0.1:3010:3000"`) and in the ssh command — the port inside the container stays the same.

### Public address

You need this if you use several devices and don't want to set up a tunnel on each one. Expect scanners to find the service: the address becomes public, and the protection is a single token.

1. In `docker-compose.yml`, replace `127.0.0.1:3000:3000` with `3000:3000`.
2. Set up a reverse proxy with HTTPS (Caddy, nginx) on your domain and proxy to `127.0.0.1:3000`. Without HTTPS, the token and transcripts travel in plain text: anyone on the route can read them, from café Wi-Fi to your ISP.
3. Add the domain to `host_permissions` in `manifest.json` and rebuild the extension. Alternatively, set `CORS_ORIGIN` to the extension's origin `chrome-extension://<id>` instead (the id is visible on `chrome://extensions`).
4. Open only the reverse proxy port (443) in the firewall, not the backend port.

A Let's Encrypt certificate requires a domain: public CAs do not issue certificates for a bare IP, and ACME validation needs either a domain (DNS-01) or free ports 80/443 (HTTP-01, TLS-ALPN).

Before going public, read "Known limitations" below: on a public address the whole protection comes down to one token, and the limits cap the damage from a leak but do not prevent it.

## Extension

The server connection is defined by the file `extension/config.json`. The extension reads it on first run; there are no server settings in the UI.

```bash
cd extension
npm install
# сгенерирует токен, выведет его и запишет config.json
node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
npm run build
```

Put the token the script prints into `backend/.env` as the line `SHARED_TOKEN=<token>` (if you have not done so already). It must match in both places.

Or create `config.json` next to `build.mjs` by hand:

```json
{ "baseUrl": "https://conspect.example.com", "sharedToken": "тот же токен, что в backend/.env" }
```

Open `chrome://extensions`, enable developer mode, click "Load unpacked", and pick `extension/dist`.

## API

- `GET /health` — availability check.
- `POST /digest/stream` — SSE stream of the summary. Header `Authorization: Bearer <SHARED_TOKEN>`. Body `{"url": "..."}`.

SSE events: `meta` (title, channel, duration), `delta` (a chunk of the summary), `done` (finished, token count), `error` (reason), `ping` (heartbeat every 10 seconds).

## LLM providers

Any OpenAI-compatible endpoint works. The server keeps no list of models; the model name is set in `.env`.

| Provider | `LLM_BASE_URL` | Example `LLM_MODEL` |
|---|---|---|
| bothub.chat | `https://openai.bothub.chat/v1` | `deepseek-v4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |

## Settings

All variables are read from `.env` (template in `.env.example`).

| Variable | Purpose | Default |
|---|---|---|
| `LLM_API_KEY` | key for an OpenAI-compatible API | required |
| `LLM_BASE_URL` | base URL of the LLM API | `https://openai.bothub.chat/v1` |
| `LLM_MODEL` | model name | `deepseek-v4-flash` |
| `MAX_TOKENS` | token limit for the LLM response | `8192` |
| `LLM_TIMEOUT_SEC` | timeout for LLM requests | `300` |
| `MAX_DURATION_MIN` | maximum video length in minutes | `180` |
| `YTDLP_PROBE_TIMEOUT_SEC` | timeout for the video check | `90` |
| `YTDLP_DOWNLOAD_TIMEOUT_SEC` | timeout for subtitle download | `180` |
| `PORT` | server port | `3000` |
| `HOST` | interface the server listens on (in Docker overridden to `0.0.0.0` by `docker-compose.yml`) | `127.0.0.1` |
| `CORS_ORIGIN` | allowed origins, comma-separated; empty means denied | empty |
| `SHARED_TOKEN` | shared secret between server and extension | required, at least 24 characters |
| `MAX_CONCURRENT_DIGESTS` | maximum simultaneous generations | `2` |
| `RATE_LIMIT_PER_MIN` | runs per minute | `10` |
| `YTDLP_AUTO_UPDATE` | auto-update yt-dlp at startup (`1` — enabled) | `0` |

## Security

`SHARED_TOKEN` is the only protection: the server does not tell users apart. Anyone who learns the address of the public server without the token will spend your LLM key. Set a long random string (24 characters or more).

Token comparison runs in constant time (`crypto.timingSafeEqual`).

Rate limiting caps the damage from a leaked token but does not cancel it: the server enforces a maximum of simultaneous generations (`MAX_CONCURRENT_DIGESTS`) and runs per minute (`RATE_LIMIT_PER_MIN`). The limits are shared because the server knows one token, not users. Keep the token secret.

Use a separate LLM provider key for the server and put a spending cap on it if the provider supports that. This is the only measure that limits the loss once the token has already leaked.

## Known limitations

- **The rate limit is shared, not per address.** The counters are global, but they only count requests with a valid token: without one, a request is rejected with a 401 before the limit check and spends no quota, and no SSE connection is opened either. While only you know the token, the limit is invisible. If the token leaks, other people's runs eat the shared quota and your LLM budget — the fix is changing the token, not tuning the limits.
- **The server does not terminate TLS.** HTTPS is the job of the reverse proxy in front of it.
- **The token cannot be revoked in part.** There is only one. After changing it, update `config.json` on every device (replacing the file in `dist` and reloading the extension is enough).
- **yt-dlp asks for a JS runtime.** The logs show `No supported JavaScript runtime could be found ... has been deprecated`. Subtitles still download, verified. If YouTube starts serving less data, put `deno` next to yt-dlp (on the system or in the image).
- **Summaries live in the browser.** The server stores nothing, so when you reinstall the browser or move to another device, the history does not come along. Save what you need as `.md`.

## License

MIT.
