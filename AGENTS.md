# AGENTS.md

Гайд для AI-агентов, работающих в этом репозитории. Self-host версия Conspect: расширение Chrome + stateless сервер.

## Что это

Конспект YouTube по клику. Сервер скачивает субтитры (yt-dlp), чистит транскрипт (`cleanTranscript.ts`, TS-порт), пишет конспект через LLM и стримит его в расширение по SSE. Расширение — тонкий клиент.

## Структура

- `backend/` — Node на Hono, TypeScript. Endpoint `POST /digest/stream` + `GET /health`.
- `extension/` — Chrome MV3, TypeScript + React 18. Service worker (`background.ts`), content script (`content.tsx`), попап (`popup.tsx`), личный кабинет (`options.tsx`), страница чтения (`read.tsx`).

## Команды

Backend (в `backend/`):

```bash
npm install
npm run build      # tsc
npm start          # node dist/main.js
npm run dev        # tsx watch
npm test           # vitest
```

Extension (в `extension/`):

```bash
npm install
npm run build      # make-icons + esbuild в dist/
npm run watch      # esbuild --watch
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

Перед правкой любого `.ts`/`.tsx` в `extension/src` прогоняй `npm run typecheck` — конфиг со `strict` и `noUnusedLocals`.

## Развёртывание

Два пути: `docker compose up -d --build` (нужен Docker Compose v2) либо `npm install && npm run build && npm start` (нужен Node 20+ и yt-dlp в PATH). Конфиг — `.env` (образец `.env.example`). Python в рантайме не нужен.

## Установка self-host: строгое правило

Настроек сервера в интерфейсе расширения нет. Подключение задаётся одним файлом `extension/config.json` (`{"baseUrl": "...", "sharedToken": "..."}`), который расширение читает при старте service worker (`background.ts`, `seedFromConfigJson`). Файл в `.gitignore` — токен не попадает в репозиторий.

Агент при установке выполняет в таком порядке:

1. Узнать у пользователя адрес сервера. Остальное — без уточнений.
2. Записать конфиг и получить токен: `node extension/scripts/configure.mjs --base-url <url> --gen-token`. Скрипт печатает токен один раз.
3. Вписать этот же токен в `backend/.env` строкой `SHARED_TOKEN=<токен>`.
4. В переписке и логах токен не выводить (маскировать). Он живёт только в `.env` и `config.json`.
5. Собрать расширение: `cd extension && npm install && npm run build` (`config.json` копируется в `dist/`, если лежит рядом с `build.mjs`).
6. Загрузить `extension/dist` как распакованное расширение.

Нельзя: встраивать адрес или токен в UI расширения, коммитить `config.json`, выводить токен в чат.

## Инварианты, которые нельзя ломать

1. **Сервер stateless.** Нет базы, нет аккаунтов, нет оплаты, нет сессий. Не добавляй состояние на сервер. Единственная защита — общий `SHARED_TOKEN` в заголовке `Authorization: Bearer`.
2. **Расширение не хранит ключ LLM.** Расширение хранит только адрес сервера и `SHARED_TOKEN`, берёт их из `config.json` (см. «Установка self-host: строгое правило»). Ключ LLM живёт только в `backend/.env`.
3. **Кэш конспектов — в браузере.** Готовый конспект пишется в `chrome.storage.local` (`lib/store.ts`, максимум 50) и сохраняется как `.md`. Сервер не хранит конспекты и не отдаёт их по запросу.
4. **Контракт SSE** в `backend/src/api.ts`: события `meta`, `delta`, `done`, `error`, `ping` (heartbeat 10 с). Клиент парсит их в `streamStore.ts` (service worker) и раздаёт через порт `digest-stream` (команды `start`/`stop`).
5. **Транскрипция и LLM — только на сервере.** Браузер не тянет субтитры и не зовёт LLM. Не переноси это в content script.
6. **Локальный биндинг по умолчанию.** `HOST=127.0.0.1` в конфиге и `127.0.0.1:3000:3000` в `docker-compose.yml`. Для публичного доступа нужен явный `HOST=0.0.0.0` плюс reverse-proxy с HTTPS. Не ослабляй дефолт.

## Анти-паттерны

- Не возвращать аккаунты, лимиты, пейвол, логин/регистрацию — это вырезано при переходе на self-host.
- Не подтягивать конспект по сети из архива/ридера: полный markdown уже в кэше (`listDigests`/`getDigest`).
- Не хардкодить адреса серверов и токены в код. Всё через `.env` (бэкенд) и `config.json` (расширение).
- `clean_transcript.py` — только эталон для тестов (`cleanTranscript.test.ts`). Рантайм использует `cleanTranscript.ts`. Не возвращай Python в рантайм.

## Сборка расширения

`build.mjs` (esbuild) собирает шесть точек входа в `dist/`: background (ESM), content/options/popup/read/offscreen (IIFE). Статика — `manifest.json`, четыре `.html` и опциональный `config.json` — копируется в `dist/`. Иконки генерит `scripts/make-icons.mjs`.
