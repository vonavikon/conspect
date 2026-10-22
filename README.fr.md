# Conspect

[RU](README.md) · [EN](README.en.md) · [中文](README.zh.md) · [Español](README.es.md) · **Français**

![Конспект собирается потоком: субтитры, анализ, структурированный конспект](docs/conspect-demo.gif)

Des résumés YouTube en un clic. Une extension Chrome lance sur votre serveur la construction d'un résumé structuré de la vidéo : le serveur télécharge les sous-titres, nettoie la transcription et renvoie le résumé en flux. L'extension est un client léger : un bouton sous le lecteur, un aperçu en direct pendant la génération, l'export en Markdown.

Self-host : ni compte, ni paiement, ni base de données. Le serveur ne stocke rien. Le résumé fini est mis en cache dans le navigateur et enregistré en `.md`.

## Architecture

- `backend/` — serveur Node sur Hono (TypeScript). Le téléchargement des sous-titres et le résumé par LLM se font entièrement côté serveur.
- `extension/` — extension Chrome MV3. Elle lit l'adresse du serveur et le mot de passe d'accès dans `config.json` ; l'interface n'a aucun réglage de serveur.

Le résumé se construit en quatre étapes : yt-dlp télécharge les sous-titres, `cleanTranscript.ts` nettoie la transcription, un LLM rédige le résumé, et le serveur envoie le texte à l'extension en streaming via SSE.

## Prérequis

- Node.js 20+.
- yt-dlp dans le PATH (à côté du serveur, ou un chemin via `YTDLP_BIN`).
- Python n'est pas nécessaire au fonctionnement. Il ne sert qu'à lancer les tests de nettoyage de la transcription, qui confrontent `cleanTranscript.ts` à la référence `clean_transcript.py`. Sans Python, le test se compare à un texte figé.

## Déploiement

Trois scénarios. Choisissez selon l'endroit où les résumés seront calculés et les appareils qui doivent y accéder.

| Scénario | Serveur | Accès | Pour qui |
|---|---|---|---|
| En local | votre ordinateur | `localhost` | essayer ; un seul ordinateur |
| VPS dédié + tunnel SSH | serveur | `localhost` via ssh | il faut un serveur qui tourne, sans l'ouvrir à internet |
| Adresse publique | serveur | `https://votre-domaine` | plusieurs appareils ; il faut un domaine et HTTPS |

### En local

Docker :

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health   # {"ok":true,"version":"1"}
```

Sans Docker :

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
npm install
npm run build
npm start
```

yt-dlp doit être dans le PATH : `pip install yt-dlp` ou un binaire tiré des releases yt-dlp. Le chemin se règle explicitement via `YTDLP_BIN`.

Dans le `config.json` de l'extension, laissez `baseUrl` à `http://localhost:3000`.

### VPS dédié + tunnel SSH

Le port du backend reste lié à `127.0.0.1` du serveur, donc fermé depuis l'extérieur. Votre ordinateur l'atteint par ssh. Pas de port à ouvrir, pas de certificat à émettre : le chiffrement, c'est ssh qui le fournit.

Sur le serveur :

```bash
git clone https://github.com/vonavikon/conspect.git
cd conspect/backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

Sur votre ordinateur :

```bash
ssh -N -L 3000:localhost:3000 user@your-server
```

Tant que cette commande tourne, `http://localhost:3000` sur votre ordinateur pointe vers le backend du serveur. Le `baseUrl` dans le `config.json` de l'extension reste `http://localhost:3000`.

Pour que le tunnel monte tout seul à la connexion et survive aux coupures réseau, prenez les scripts prêts à l'emploi : [`scripts/tunnel/`](scripts/tunnel/) (Windows, Linux, macOS).

Si le port 3000 du serveur est déjà pris, changez le mappage dans `docker-compose.yml` (`"127.0.0.1:3010:3000"`) et dans la commande ssh — dans le conteneur, le port ne change pas.

### Adresse publique

Ce cas sert si vous utilisez plusieurs appareils sans vouloir monter un tunnel sur chacun. Attendez-vous à ce que des scanners trouvent le service : l'adresse devient publique et la protection tient dans un seul token.

1. Dans `docker-compose.yml`, remplacez `127.0.0.1:3000:3000` par `3000:3000`.
2. Installez un reverse-proxy avec HTTPS (Caddy, nginx) sur votre domaine et proxifiez vers `127.0.0.1:3000`. Sans HTTPS, le token et les transcriptions circulent en clair : n'importe qui sur la route peut les lire, du Wi-Fi du café au fournisseur d'accès.
3. Déclarez le domaine dans `host_permissions` dans `manifest.json` puis recompilez l'extension. Autre option : indiquez dans `CORS_ORIGIN` l'origin de l'extension `chrome-extension://<id>` (l'id se voit sur `chrome://extensions`).
4. N'ouvrez dans le pare-feu que le port du reverse-proxy (443), pas celui du backend.

Le certificat Let's Encrypt exige un domaine : les AC publiques n'émettent pas de certificat pour une simple IP, et la validation ACME réclame soit un domaine (DNS-01), soit les ports 80/443 libres (HTTP-01, TLS-ALPN).

Avant de publier, lisez « Limitations connues » plus bas : sur une adresse publique, toute la protection se réduit à un token, et les limites plafonnent les dégâts d'une fuite sans les empêcher.

## Extension

La connexion au serveur est définie par le fichier `extension/config.json`. L'extension le lit au premier lancement ; aucun réglage de serveur dans l'interface.

```bash
cd extension
npm install
# сгенерирует токен, выведет его и запишет config.json
node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
npm run build
```

Le token affiché par le script, reportez-le dans `backend/.env` sous la forme `SHARED_TOKEN=<token>` (si ce n'est pas déjà fait). Il doit être identique aux deux endroits.

Ou créez `config.json` à côté de `build.mjs` à la main :

```json
{ "baseUrl": "https://conspect.example.com", "sharedToken": "тот же токен, что в backend/.env" }
```

Ouvrez `chrome://extensions`, activez le mode développeur, cliquez sur « Charger l'extension non empaquetée », puis choisissez `extension/dist`.

## API

- `GET /health` — vérification de disponibilité.
- `POST /digest/stream` — flux SSE du résumé. En-tête `Authorization: Bearer <SHARED_TOKEN>`. Corps `{"url": "..."}`.

Événements SSE : `meta` (titre, chaîne, durée), `delta` (un morceau du résumé), `done` (terminé, nombre de tokens), `error` (raison), `ping` (heartbeat toutes les 10 secondes).

## Fournisseurs LLM

Tout endpoint compatible OpenAI fait l'affaire. Le serveur ne garde pas de liste de modèles ; le nom du modèle se règle dans `.env`.

| Fournisseur | `LLM_BASE_URL` | Exemple `LLM_MODEL` |
|---|---|---|
| bothub.chat | `https://openai.bothub.chat/v1` | `deepseek-v4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |

## Réglages

Toutes les variables se lisent dans `.env` (modèle dans `.env.example`).

| Variable | Rôle | Par défaut |
|---|---|---|
| `LLM_API_KEY` | clé pour une API compatible OpenAI | obligatoire |
| `LLM_BASE_URL` | URL de base de l'API LLM | `https://openai.bothub.chat/v1` |
| `LLM_MODEL` | nom du modèle | `deepseek-v4-flash` |
| `MAX_TOKENS` | limite de tokens de la réponse du LLM | `8192` |
| `LLM_TIMEOUT_SEC` | délai maximal de la requête au LLM | `300` |
| `MAX_DURATION_MIN` | durée maximale de la vidéo en minutes | `180` |
| `YTDLP_PROBE_TIMEOUT_SEC` | délai maximal de vérification de la vidéo | `90` |
| `YTDLP_DOWNLOAD_TIMEOUT_SEC` | délai maximal de téléchargement des sous-titres | `180` |
| `PORT` | port du serveur | `3000` |
| `HOST` | interface d'écoute du serveur (sous Docker, surchargée à `0.0.0.0` par `docker-compose.yml`) | `127.0.0.1` |
| `CORS_ORIGIN` | origins autorisés, séparés par des virgules ; vide = refus | vide |
| `SHARED_TOKEN` | secret partagé entre le serveur et l'extension | obligatoire, 24 caractères minimum |
| `MAX_CONCURRENT_DIGESTS` | maximum de générations simultanées | `2` |
| `RATE_LIMIT_PER_MIN` | lancements par minute | `10` |
| `YTDLP_AUTO_UPDATE` | mise à jour automatique de yt-dlp au démarrage (`1` = activée) | `0` |

## Sécurité

`SHARED_TOKEN` est la seule protection : le serveur ne distingue pas les utilisateurs. Quiconque connaît l'adresse du serveur public sans le token dépensera votre clé LLM. Mettez une longue chaîne aléatoire (24 caractères minimum).

La comparaison du token se fait en temps constant (`crypto.timingSafeEqual`).

Le rate limit borne les dégâts d'une fuite de token mais ne l'annule pas : le serveur applique un maximum de générations simultanées (`MAX_CONCURRENT_DIGESTS`) et de lancements par minute (`RATE_LIMIT_PER_MIN`). Les limites sont communes parce que le serveur connaît un token, pas des utilisateurs. Gardez le token secret.

Prenez une clé LLM dédiée pour le serveur et fixez-lui un plafond de dépenses, si le fournisseur le permet. C'est la seule mesure qui limite la perte une fois le token filtré.

## Limitations connues

- **Le rate limit est commun, pas par adresse.** Les compteurs sont globaux, mais ne comptent que les requêtes avec un token valide : sans lui, la requête est rejetée en 401 avant le contrôle de limite et ne consomme pas de quota, et la connexion SSE ne s'ouvre pas non plus. Tant que le token n'est connu que de vous, la limite est invisible. S'il fuit, les lancements d'autrui mangent le quota commun et votre budget LLM — le remède est de changer le token, pas de régler les limites.
- **Le serveur ne termine pas le TLS.** Le HTTPS est l'affaire du reverse-proxy devant lui.
- **Le token ne se révoque pas partiellement.** Il n'y en a qu'un. Après changement, mettez à jour `config.json` sur chaque appareil (remplacer le fichier dans `dist` et recharger l'extension suffit).
- **yt-dlp réclame un runtime JS.** Les logs montrent `No supported JavaScript runtime could be found ... has been deprecated`. Les sous-titres se téléchargent quand même, c'est vérifié. Si YouTube se met à servir moins de données, posez `deno` à côté de yt-dlp (sur le système ou dans l'image).
- **Les résumés vivent dans le navigateur.** Le serveur ne stocke rien, donc en réinstallant le navigateur ou en changeant d'appareil, l'historique ne suit pas. Enregistrez en `.md` ce qui compte.

## Licence

MIT.
