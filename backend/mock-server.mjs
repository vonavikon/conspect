// A mock SSE server for debugging the extension's screens. Dev-only; not shipped.
// Emulates the backend/src/api.ts contract: POST /digest/stream → SSE meta/delta/done/error/ping
// and GET /health. No yt-dlp, no LLM — serves a prepared markdown with delays, so you can
// see all panel/popup states: loading (stages + timer), streaming, done.
//
// Triggers via the url in the request body:
//   *url* contains "nocaptions" → error no_captions
//   *url* contains "toolong"    → error too_long
//   otherwise                   → happy-path (meta → delta… → done)
//
// Run: node mock-server.mjs   (port from PORT, default 3000)

import http from "node:http";

const PORT = Number(process.env.PORT) || 3000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

const MARKDOWN = `DNS превращает доменное имя в IP-адрес. Запрос проходит через резолвер, корневые серверы, серверы TLD и авторитативный сервер; ответ кэшируется на каждом уровне, чтобы повторные запросы не ходили по всей цепочке.

## Что такое DNS (0:20)

DNS — это распределённая телефонная книга интернета. Браузеру нужен IP-адрес, а человек помнит доменное имя. Система переводит одно в другое.

- домен — имя, удобное человеку
- IP-адрес — адрес, по которому реально ходит трафик

## Цепочка разрешения имени (3:45)

Разрешение имени идёт сверху вниз по иерархии серверов, если ответа нет в кэше.

1. резолвер (обычно у провайдера) принимает запрос
2. корневые серверы указывают на TLD
3. серверы TLD указывают на авторитативный сервер домена
4. авторитативный сервер отдаёт итоговую A/AAAA-запись

## Кэширование и TTL (8:12)

Каждый ответ несёт TTL — сколько секунд его можно хранить в кэше. Чем дольше TTL, тем меньше нагрузка на инфраструктуру, но тем медленнее подхватываются изменения адреса.

- короткий TTL ускоряет миграцию, но плодит запросы
- длинный TTL экономит ресурсы, но задерживает изменения

## Безопасность: DNSSEC и DoH (12:30)

Классический DNS передаёт запросы открытым текстом. DNSSEC подписывает ответы, чтобы их нельзя было подменить, а DoH заворачивает запросы в HTTPS, чтобы их не видел провайдер.

## Выводы (16:40)

DNS — пример удачной распределённой системы: иерархия плюс кэширование дают масштаб, а TTL управляет компромиссом между свежестью и нагрузкой.`;

// happy-path: meta, then delta chunks, then done. Delays so the states are visible.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/digest/stream") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let url = "";
    try {
      url = JSON.parse(body || "{}").url ?? "";
    } catch {
      /* not JSON — url stays empty */
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS,
    });

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    // error branches by the marker in the url
    if (url.includes("nocaptions")) {
      await sleep(1200);
      if (!closed) sse(res, "error", { reason: "no_captions" });
      res.end();
      return;
    }
    if (url.includes("toolong")) {
      await sleep(1200);
      if (!closed) sse(res, "error", { reason: "too_long" });
      res.end();
      return;
    }

    // happy-path
    const chunks = [];
    const step = Math.ceil(MARKDOWN.length / 5);
    for (let i = 0; i < MARKDOWN.length; i += step) chunks.push(MARKDOWN.slice(i, i + step));

    await sleep(300);
    if (closed) return;
    sse(res, "ping", {});

    await sleep(900);
    if (closed) return;
    sse(res, "meta", {
      title: "Как работает DNS: от домена до IP-адреса",
      channel: "Mock Канал",
      durationSec: 1080,
      lang: "ru",
    });

    for (const c of chunks) {
      await sleep(500);
      if (closed) return;
      sse(res, "delta", { delta: c });
    }

    await sleep(300);
    if (!closed) sse(res, "done", {});
    res.end();
    return;
  }

  res.writeHead(404, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`mock-server: http://localhost:${PORT}  (/health, POST /digest/stream)`);
});
