#!/usr/bin/env node
// Deterministic extension setup: writes extension/config.json with the server address
// and the shared token. Run by the agent or the user at install time. The extension
// reads config.json on the first service worker start; there are no server settings in
// the UI. The file is in .gitignore: the token never reaches the repo.
//
//   node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
//   node scripts/configure.mjs --base-url http://127.0.0.1:3000 --token <value>
//
// With --gen-token the script prints the generated token once. The same token must go into
// backend/.env as the line SHARED_TOKEN=<token>. The script never prints the token elsewhere.
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
