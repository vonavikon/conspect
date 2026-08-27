#!/usr/bin/env node
// Детерминированная настройка расширения: пишет extension/config.json с адресом сервера
// и общим токеном. Запускается агентом или пользователем при установке. Расширение
// читает config.json при первом запуске service worker; настроек сервера в интерфейсе
// нет. Файл в .gitignore: токен не попадает в репозиторий.
//
//   node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
//   node scripts/configure.mjs --base-url http://127.0.0.1:3000 --token <значение>
//
// С --gen-token скрипт печатает сгенерированный токен один раз. Его же надо вписать в
// backend/.env строкой SHARED_TOKEN=<токен>. Больше скрипт токен нигде не выводит.
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "config.json");

function readArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const baseUrlRaw = readArg("base-url");
const tokenArg = readArg("token");
const genToken = process.argv.includes("--gen-token");

if (!baseUrlRaw) {
  console.error("Укажите --base-url <адрес сервера>");
  process.exit(1);
}

const baseUrl = baseUrlRaw.trim().replace(/\/+$/, "");
if (!/^https?:\/\//.test(baseUrl)) {
  console.error("base-url должен начинаться с http:// или https://");
  process.exit(1);
}

let sharedToken;
if (genToken) {
  sharedToken = randomBytes(24).toString("hex");
} else if (tokenArg) {
  sharedToken = tokenArg.trim();
} else {
  console.error("Укажите --token <токен> или --gen-token");
  process.exit(1);
}

if (sharedToken.length < 24) {
  console.error("Токен короче 24 символов. Задайте длинную случайную строку.");
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ baseUrl, sharedToken }, null, 2) + "\n");

if (genToken) {
  console.log(`config.json записан: ${OUT}`);
  console.log("Впишите этот токен в backend/.env как SHARED_TOKEN:");
  console.log(sharedToken);
} else {
  console.log(`config.json записан: ${OUT}`);
}
