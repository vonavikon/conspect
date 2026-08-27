# Conspect (self-host)

Конспект YouTube по клику. Расширение Chrome запускает сборку структурированного конспекта видео на вашем сервере: сервер скачивает субтитры, чистит транскрипт и отдаёт конспект потоком. Расширение — тонкий клиент: кнопка под плеером, живой превью по мере генерации, экспорт в Markdown.

Self-host: аккаунтов, оплаты и базы данных нет. Сервер не хранит ничего. Готовый конспект кэшируется в браузере и сохраняется как `.md`.

## Архитектура

- `backend/` — сервер Node на Hono (TypeScript). Скачивание субтитров и саммари через LLM целиком на сервере.
- `extension/` — расширение Chrome MV3. Адрес сервера и пароль доступа читает из `config.json`, в интерфейсе настроек сервера нет.

Конспект собирается в четыре шага: yt-dlp скачивает субтитры, `cleanTranscript.ts` чистит транскрипт, LLM пишет конспект, сервер стримит текст в расширение по SSE.

## Требования

- Node.js 20+.
- yt-dlp в PATH (либо рядом с сервером, либо путь через `YTDLP_BIN`).
- Python для запуска не нужен. Он нужен только чтобы прогонять тесты чистки транскрипта — сверка `cleanTranscript.ts` с эталоном `clean_transcript.py`. Без Python тест сверяется с зафиксированным текстом.

## Развёртывание

### Docker (проще)

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
```

Сервер слушает `127.0.0.1:3000`. Проверка — `GET /health`.

### Без Docker (Node напрямую)

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
npm install
npm run build
npm start
```

yt-dlp должен быть в PATH. Установить можно через `pip install yt-dlp` или скачав бинарник из релизов yt-dlp.

### Публичный VPS

По умолчанию сервер слушает только localhost (`HOST=127.0.0.1`), а `docker compose` пробрасывает порт на `127.0.0.1`. Для доступа снаружи:

1. В `.env` поставьте `HOST=0.0.0.0`.
2. В `docker-compose.yml` замените `127.0.0.1:3000:3000` на `3000:3000`.
3. Закройте сервер reverse-proxy (Caddy, nginx) с HTTPS. Без HTTPS токен уходит по сети открытым текстом.
4. Настройте CORS: для localhost он не нужен (адрес уже в `host_permissions` расширения). Для публичного адреса поставьте в `CORS_ORIGIN` origin расширения `chrome-extension://<id>` (id виден на `chrome://extensions`), либо добавьте адрес VPS в `host_permissions` в `manifest.json` и пересоберите расширение.

## Расширение

Подключение к серверу задаётся файлом `extension/config.json`. Расширение читает его при первом запуске; настроек сервера в интерфейсе нет.

```bash
cd extension
npm install
# сгенерирует токен, выведет его и запишет config.json
node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
npm run build
```

Токен, который напечатал скрипт, впишите в `backend/.env` строкой `SHARED_TOKEN=<токен>` (если ещё не делали). Он должен совпадать в обоих местах.

Либо создайте `config.json` рядом с `build.mjs` вручную:

```json
{ "baseUrl": "https://conspect.example.com", "sharedToken": "тот же токен, что в backend/.env" }
```

Откройте `chrome://extensions`, включите режим разработчика, «Загрузить распакованное», выберите `extension/dist`.

## API

- `GET /health` — проверка доступности.
- `POST /digest/stream` — SSE-стрим конспекта. Заголовок `Authorization: Bearer <SHARED_TOKEN>`. Тело `{"url": "..."}`.

События SSE: `meta` (название, канал, длительность), `delta` (кусок конспекта), `done` (готово, число токенов), `error` (причина), `ping` (heartbeat каждые 10 секунд).

## Провайдеры LLM

Подойдёт любой OpenAI-совместимый эндпоинт. Сервер не держит списка моделей, имя модели указывается в `.env`.

| Провайдер | `LLM_BASE_URL` | Пример `LLM_MODEL` |
|---|---|---|
| bothub.chat | `https://openai.bothub.chat/v1` | `deepseek-v4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |

## Настройки

Все переменные читаются из `.env` (образец — `.env.example`).

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `LLM_API_KEY` | ключ OpenAI-совместимого API | обязательна |
| `LLM_BASE_URL` | базовый URL LLM API | `https://openai.bothub.chat/v1` |
| `LLM_MODEL` | имя модели | `deepseek-v4-flash` |
| `MAX_TOKENS` | лимит токенов ответа LLM | `8192` |
| `LLM_TIMEOUT_SEC` | таймаут запроса к LLM | `300` |
| `MAX_DURATION_MIN` | максимум длины видео в минутах | `180` |
| `YTDLP_PROBE_TIMEOUT_SEC` | таймаут проверки видео | `90` |
| `YTDLP_DOWNLOAD_TIMEOUT_SEC` | таймаут скачивания субтитров | `180` |
| `PORT` | порт сервера | `3000` |
| `HOST` | интерфейс, на котором слушает сервер | `127.0.0.1` |
| `CORS_ORIGIN` | разрешённые origin через запятую, пусто — запрет | пусто |
| `SHARED_TOKEN` | общий секрет между сервером и расширением | обязателен, от 24 символов |
| `MAX_CONCURRENT_DIGESTS` | максимум одновременных генераций | `2` |
| `RATE_LIMIT_PER_MIN` | запусков в минуту | `10` |
| `YTDLP_AUTO_UPDATE` | автообновление yt-dlp при старте (`1` — включено) | `0` |

## Безопасность

`SHARED_TOKEN` — единственная защита: сервер не различает пользователей. Любой, кто узнал адрес публичного сервера без токена, потратит ваш LLM-ключ. Задайте длинную случайную строку (от 24 символов).

Сравнение токена — константное по времени (`crypto.timingSafeEqual`).

Rate limit ограничивает ущерб от утечки токена, но не отменяет его: сервер держит максимум одновременных генераций (`MAX_CONCURRENT_DIGESTS`) и запусков в минуту (`RATE_LIMIT_PER_MIN`). Лимиты общие, потому что сервер знает один токен, а не пользователей. Токен держите в секрете.

## Лицензия

MIT.
