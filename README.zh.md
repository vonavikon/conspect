# Conspect

[RU](README.md) · [EN](README.en.md) · **中文** · [Español](README.es.md) · [Français](README.fr.md)

![Конспект собирается потоком: субтитры, анализ, структурированный конспект](docs/conspect-demo.gif)

一键生成 YouTube 视频笔记。Chrome 扩展在你的服务器上启动视频结构化笔记的生成：服务器下载字幕、清洗转录文本，并以流式方式返回笔记。扩展是瘦客户端：播放器下方一个按钮，生成过程中实时预览，可导出为 Markdown。

自托管：没有账号、没有付费、没有数据库。服务器不存储任何内容。生成好的笔记缓存在浏览器里，可保存为 `.md` 文件。

## 架构

- `backend/` — 基于 Hono 的 Node 服务器（TypeScript）。字幕下载和 LLM 摘要全部在服务器端完成。
- `extension/` — Chrome MV3 扩展。从 `config.json` 读取服务器地址和访问密码，界面里没有服务器设置。

笔记分四步生成：yt-dlp 下载字幕，`cleanTranscript.ts` 清洗转录文本，LLM 撰写笔记，服务器通过 SSE 把文本流式发给扩展。

## 环境要求

- Node.js 20+。
- yt-dlp 在 PATH 中（与服务器放在一起，或通过 `YTDLP_BIN` 指定路径）。
- 运行不需要 Python。它只在跑转录清洗测试时用到——把 `cleanTranscript.ts` 和参照实现 `clean_transcript.py` 做比对。没有 Python 时，测试与固定的文本比对。

## 部署

三种方案。根据笔记在哪里生成、需要从哪些设备访问来选择。

| 方案 | 服务器 | 访问方式 | 适用场景 |
|---|---|---|---|
| 本地运行 | 你的电脑 | `localhost` | 先试用；单台电脑 |
| 自有 VPS + SSH 隧道 | 服务器 | `localhost`（经 ssh） | 需要一台常驻服务器，但不想把它暴露到公网 |
| 公网地址 | 服务器 | `https://你的域名` | 多设备使用；需要域名和 HTTPS |

### 本地运行

Docker 方式：

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health   # {"ok":true,"version":"1"}
```

不使用 Docker：

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
npm install
npm run build
npm start
```

yt-dlp 必须在 PATH 中：`pip install yt-dlp`，或使用 yt-dlp releases 页面的可执行文件。也可以通过 `YTDLP_BIN` 显式指定路径。

扩展的 `config.json` 中，`baseUrl` 保持为 `http://localhost:3000`。

### 自有 VPS + SSH 隧道

后端端口仍绑定在服务器的 `127.0.0.1` 上，从外部无法访问。你的电脑通过 ssh 连到它。不需要开放端口，也不需要签发证书：加密由 ssh 本身完成。

在服务器上：

```bash
git clone https://github.com/vonavikon/conspect.git
cd conspect/backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

在你的电脑上：

```bash
ssh -N -L 3000:localhost:3000 user@your-server
```

这条命令运行期间，你电脑上的 `http://localhost:3000` 就是服务器上的后端。扩展 `config.json` 里的 `baseUrl` 保持为 `http://localhost:3000`。

如果希望隧道在登录时自动拉起、断线后自动恢复，可以直接用现成脚本：[`scripts/tunnel/`](scripts/tunnel/)（Windows、Linux、macOS）。

如果服务器的 3000 端口被其他程序占用，修改 `docker-compose.yml` 中的端口映射（`"127.0.0.1:3010:3000"`）和 ssh 命令中的端口——容器内的端口保持不变。

### 公网地址

只有在多台设备上使用、又不想每台都建隧道时才需要这个方案。要做好服务会被扫描器发现的准备：地址将变成公开的，而防线只有一个 token。

1. 在 `docker-compose.yml` 中把 `127.0.0.1:3000:3000` 改为 `3000:3000`。
2. 在你的域名上部署带 HTTPS 的反向代理（Caddy、nginx），代理到 `127.0.0.1:3000`。没有 HTTPS 时，token 和转录文本以明文传输：链路上的任何人都读得到，从咖啡馆的 Wi-Fi 到运营商。
3. 把域名写进 `manifest.json` 的 `host_permissions`，重新构建扩展。也可以改用另一种方式：在 `CORS_ORIGIN` 中填写扩展的 origin `chrome-extension://<id>`（id 可在 `chrome://extensions` 查看）。
4. 防火墙只放行反向代理的端口（443），不放行后端端口。

Let's Encrypt 证书需要域名：公共 CA 不为裸 IP 签发证书，而 ACME 验证要么需要域名（DNS-01），要么需要 80/443 端口空闲（HTTP-01、TLS-ALPN）。

公开之前，请先阅读下面的“已知限制”：在公网地址上，全部防线就是一个 token，各项限额只能减少 token 泄露带来的损失，不能消除它。

## 扩展

与服务器的连接由 `extension/config.json` 定义。扩展在首次启动时读取它；界面里没有服务器设置。

```bash
cd extension
npm install
# сгенерирует токен, выведет его и запишет config.json
node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
npm run build
```

把脚本打印的 token 写入 `backend/.env`，格式为 `SHARED_TOKEN=<token>`（如果还没写过）。两边的值必须一致。

也可以在 `build.mjs` 旁边手动创建 `config.json`：

```json
{ "baseUrl": "https://conspect.example.com", "sharedToken": "тот же токен, что в backend/.env" }
```

打开 `chrome://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择 `extension/dist`。

## API

- `GET /health` — 可用性检查。
- `POST /digest/stream` — 笔记的 SSE 流。请求头 `Authorization: Bearer <SHARED_TOKEN>`。请求体 `{"url": "..."}`。

SSE 事件：`meta`（标题、频道、时长）、`delta`（一段笔记）、`done`（完成，token 数量）、`error`（原因）、`ping`（每 10 秒一次心跳）。

## LLM 提供商

任何 OpenAI 兼容的 endpoint 都可以使用。服务器不维护模型列表，模型名在 `.env` 中指定。

| 提供商 | `LLM_BASE_URL` | `LLM_MODEL` 示例 |
|---|---|---|
| bothub.chat | `https://openai.bothub.chat/v1` | `deepseek-v4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |

## 配置

所有变量从 `.env` 读取（模板见 `.env.example`）。

| 变量 | 用途 | 默认值 |
|---|---|---|
| `LLM_API_KEY` | OpenAI 兼容 API 的密钥 | 必填 |
| `LLM_BASE_URL` | LLM API 的 base URL | `https://openai.bothub.chat/v1` |
| `LLM_MODEL` | 模型名 | `deepseek-v4-flash` |
| `MAX_TOKENS` | LLM 回复的 token 上限 | `8192` |
| `LLM_TIMEOUT_SEC` | LLM 请求超时 | `300` |
| `MAX_DURATION_MIN` | 视频时长上限（分钟） | `180` |
| `YTDLP_PROBE_TIMEOUT_SEC` | 视频检查超时 | `90` |
| `YTDLP_DOWNLOAD_TIMEOUT_SEC` | 字幕下载超时 | `180` |
| `PORT` | 服务器端口 | `3000` |
| `HOST` | 服务器监听的网卡（Docker 下由 `docker-compose.yml` 覆盖为 `0.0.0.0`） | `127.0.0.1` |
| `CORS_ORIGIN` | 允许的 origin，逗号分隔；留空即全部拒绝 | 空 |
| `SHARED_TOKEN` | 服务器与扩展共享的密钥 | 必填，至少 24 个字符 |
| `MAX_CONCURRENT_DIGESTS` | 最大同时生成数 | `2` |
| `RATE_LIMIT_PER_MIN` | 每分钟启动次数 | `10` |
| `YTDLP_AUTO_UPDATE` | 启动时自动更新 yt-dlp（`1` 为开启） | `0` |

## 安全性

`SHARED_TOKEN` 是唯一的防线：服务器不区分用户。任何人只要拿到公网服务器地址而没有 token，就会花掉你的 LLM 密钥。请设置一个足够长的随机字符串（不少于 24 个字符）。

token 比较采用恒定时间算法（`crypto.timingSafeEqual`）。

限流能减少 token 泄露带来的损失，但不能消除它：服务器限制最大同时生成数（`MAX_CONCURRENT_DIGESTS`）和每分钟启动次数（`RATE_LIMIT_PER_MIN`）。限额是全局共享的，因为服务器只认识一个 token，不认识用户。请对 token 保密。

给服务器单独用一个 LLM 提供商密钥，并设置消费上限（如果提供商支持）。这是 token 泄露之后唯一能限制损失的措施。

## 已知限制

- **限流是全局的，不按地址区分。** 计数器是全局的，但只统计携带正确 token 的请求：没有 token 的请求在限流检查之前就被 401 拒绝，不消耗配额，SSE 连接也不会建立。只要 token 只有你知道，这个限制就没有影响。token 一旦泄露，别人的调用会吃掉共享配额和你的 LLM 预算——解决办法是更换 token，而不是调整限额。
- **服务器不做 TLS 终结。** HTTPS 由它前面的反向代理负责。
- **token 无法部分吊销。** 它只有一个。更换后需要在每台设备上更新 `config.json`（替换 `dist` 里的文件并重新加载扩展即可）。
- **yt-dlp 需要 JS 运行时。** 日志里会出现 `No supported JavaScript runtime could be found ... has been deprecated`。字幕仍能正常下载，已验证。如果 YouTube 开始减少提供的数据，把 `deno` 放到 yt-dlp 旁边（系统里或镜像里）。
- **笔记保存在浏览器里。** 服务器不存储任何内容，所以重装浏览器或换设备时历史不会跟着迁移。需要的内容请保存为 `.md`。

## 许可证

MIT.
