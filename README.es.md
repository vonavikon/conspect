# Conspect

[RU](README.md) · [EN](README.en.md) · [中文](README.zh.md) · **Español** · [Français](README.fr.md)

![Конспект собирается потоком: субтитры, анализ, структурированный конспект](docs/conspect-demo.gif)

Resúmenes de YouTube en un clic. Una extensión de Chrome lanza en tu servidor la construcción de un resumen estructurado del vídeo: el servidor descarga los subtítulos, limpia la transcripción y devuelve el resumen en streaming. La extensión es un cliente ligero: un botón bajo el reproductor, vista previa en vivo durante la generación y exportación a Markdown.

Self-host: no hay cuentas, pagos ni base de datos. El servidor no guarda nada. El resumen terminado se cachea en el navegador y se guarda como `.md`.

## Arquitectura

- `backend/` — servidor Node sobre Hono (TypeScript). La descarga de subtítulos y el resumen con LLM ocurren por completo en el servidor.
- `extension/` — extensión de Chrome MV3. Lee la dirección del servidor y la contraseña de acceso de `config.json`; no hay ajustes de servidor en la interfaz.

El resumen se construye en cuatro pasos: yt-dlp descarga los subtítulos, `cleanTranscript.ts` limpia la transcripción, un LLM escribe el resumen y el servidor manda el texto en streaming a la extensión por SSE.

## Requisitos

- Node.js 20+.
- yt-dlp en el PATH (junto al servidor, o la ruta vía `YTDLP_BIN`).
- Python no hace falta para ejecutarlo. Solo sirve para correr las pruebas de limpieza de la transcripción, que comparan `cleanTranscript.ts` con la referencia `clean_transcript.py`. Sin Python, la prueba se compara con un texto fijado.

## Despliegue

Tres escenarios. Elige según dónde se calcularán los resúmenes y desde qué dispositivos necesites acceso.

| Escenario | Servidor | Acceso | Para quién |
|---|---|---|---|
| Local | tu equipo | `localhost` | probar; un solo equipo |
| VPS propio + túnel SSH | servidor | `localhost` por ssh | quieres un servidor en marcha, pero sin abrirlo a internet |
| Dirección pública | servidor | `https://tu-dominio` | varios dispositivos; hace falta dominio y HTTPS |

### Local

Docker:

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health   # {"ok":true,"version":"1"}
```

Sin Docker:

```bash
cd backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
npm install
npm run build
npm start
```

yt-dlp debe estar en el PATH: `pip install yt-dlp` o un binario de los releases de yt-dlp. La ruta se puede fijar explícitamente con `YTDLP_BIN`.

En el `config.json` de la extensión deja `baseUrl` con el valor `http://localhost:3000`.

### VPS propio + túnel SSH

El puerto del backend queda ligado a `127.0.0.1` del servidor, es decir, cerrado desde fuera. Tu equipo llega a él por ssh. No hace falta abrir puertos ni emitir certificados: el cifrado lo da el propio ssh.

En el servidor:

```bash
git clone https://github.com/vonavikon/conspect.git
cd conspect/backend
cp .env.example .env
# заполните LLM_API_KEY и SHARED_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

En tu equipo:

```bash
ssh -N -L 3000:localhost:3000 user@your-server
```

Mientras ese comando esté activo, `http://localhost:3000` en tu equipo es el backend del servidor. El `baseUrl` del `config.json` de la extensión sigue siendo `http://localhost:3000`.

Para que el túnel se levante solo al iniciar sesión y aguante los cortes de conexión, usa los scripts ya preparados: [`scripts/tunnel/`](scripts/tunnel/) (Windows, Linux, macOS).

Si el puerto 3000 del servidor está ocupado por otra cosa, cambia el mapeo en `docker-compose.yml` (`"127.0.0.1:3010:3000"`) y en el comando ssh; dentro del contenedor el puerto sigue siendo el mismo.

### Dirección pública

Hace falta si usas varios dispositivos y no quieres montar un túnel en cada uno. Prepárate para que los escáneres vean el servicio: la dirección pasa a ser pública y la protección es un solo token.

1. En `docker-compose.yml` sustituye `127.0.0.1:3000:3000` por `3000:3000`.
2. Monta un reverse-proxy con HTTPS (Caddy, nginx) en tu dominio y proxya hacia `127.0.0.1:3000`. Sin HTTPS, el token y las transcripciones viajan en texto plano: cualquiera en la ruta puede leerlos, desde el Wi-Fi de la cafetería hasta tu proveedor.
3. Añade el dominio a `host_permissions` en `manifest.json` y recompila la extensión. Como alternativa, indica en `CORS_ORIGIN` el origin de la extensión `chrome-extension://<id>` (el id se ve en `chrome://extensions`).
4. Abre en el firewall solo el puerto del reverse-proxy (443), no el del backend.

El certificado de Let's Encrypt exige un dominio: las CA públicas no emiten certificados para una IP a secas, y la validación ACME pide o un dominio (DNS-01) o los puertos 80/443 libres (HTTP-01, TLS-ALPN).

Antes de publicar, lee «Limitaciones conocidas» más abajo: en una dirección pública toda la protección se reduce a un token, y los límites acotan el daño de una fuga pero no lo evitan.

## Extensión

La conexión al servidor la define el archivo `extension/config.json`. La extensión lo lee en el primer arranque; no hay ajustes de servidor en la interfaz.

```bash
cd extension
npm install
# сгенерирует токен, выведет его и запишет config.json
node scripts/configure.mjs --base-url https://conspect.example.com --gen-token
npm run build
```

El token que imprime el script, escríbelo en `backend/.env` como `SHARED_TOKEN=<token>` (si aún no lo has hecho). Debe coincidir en ambos sitios.

O crea `config.json` junto a `build.mjs` a mano:

```json
{ "baseUrl": "https://conspect.example.com", "sharedToken": "тот же токен, что в backend/.env" }
```

Abre `chrome://extensions`, activa el modo de desarrollador, pulsa «Cargar descomprimida» y elige `extension/dist`.

## API

- `GET /health` — comprobación de disponibilidad.
- `POST /digest/stream` — stream SSE del resumen. Cabecera `Authorization: Bearer <SHARED_TOKEN>`. Cuerpo `{"url": "..."}`.

Eventos SSE: `meta` (título, canal, duración), `delta` (un trozo del resumen), `done` (listo, número de tokens), `error` (motivo), `ping` (heartbeat cada 10 segundos).

## Proveedores LLM

Vale cualquier endpoint compatible con OpenAI. El servidor no guarda una lista de modelos; el nombre del modelo se indica en `.env`.

| Proveedor | `LLM_BASE_URL` | Ejemplo de `LLM_MODEL` |
|---|---|---|
| bothub.chat | `https://openai.bothub.chat/v1` | `deepseek-v4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |

## Ajustes

Todas las variables se leen de `.env` (muestra en `.env.example`).

| Variable | Función | Por defecto |
|---|---|---|
| `LLM_API_KEY` | clave para una API compatible con OpenAI | obligatoria |
| `LLM_BASE_URL` | URL base de la API del LLM | `https://openai.bothub.chat/v1` |
| `LLM_MODEL` | nombre del modelo | `deepseek-v4-flash` |
| `MAX_TOKENS` | límite de tokens de la respuesta del LLM | `8192` |
| `LLM_TIMEOUT_SEC` | tiempo máximo de la petición al LLM | `300` |
| `MAX_DURATION_MIN` | duración máxima del vídeo en minutos | `180` |
| `YTDLP_PROBE_TIMEOUT_SEC` | tiempo máximo de la comprobación del vídeo | `90` |
| `YTDLP_DOWNLOAD_TIMEOUT_SEC` | tiempo máximo de descarga de subtítulos | `180` |
| `PORT` | puerto del servidor | `3000` |
| `HOST` | interfaz donde escucha el servidor (en Docker se sobrescribe con `0.0.0.0` desde `docker-compose.yml`) | `127.0.0.1` |
| `CORS_ORIGIN` | origins permitidos, separados por comas; vacío, denegación | vacío |
| `SHARED_TOKEN` | secreto compartido entre servidor y extensión | obligatorio, mínimo 24 caracteres |
| `MAX_CONCURRENT_DIGESTS` | máximo de generaciones simultáneas | `2` |
| `RATE_LIMIT_PER_MIN` | arranques por minuto | `10` |
| `YTDLP_AUTO_UPDATE` | autoactualizar yt-dlp al arrancar (`1` — activado) | `0` |

## Seguridad

`SHARED_TOKEN` es la única protección: el servidor no distingue usuarios. Cualquiera que conozca la dirección del servidor público sin el token gastará tu clave LLM. Pon una cadena aleatoria larga (mínimo 24 caracteres).

La comparación del token es de tiempo constante (`crypto.timingSafeEqual`).

El rate limit acota el daño de una fuga del token, pero no lo anula: el servidor aplica un máximo de generaciones simultáneas (`MAX_CONCURRENT_DIGESTS`) y de arranques por minuto (`RATE_LIMIT_PER_MIN`). Los límites son comunes porque el servidor conoce un token, no usuarios. Guarda el token en secreto.

Usa para el servidor una clave aparte del proveedor LLM y ponle un límite de gasto, si el proveedor lo permite. Es la única medida que acota la pérdida cuando el token ya se ha filtrado.

## Limitaciones conocidas

- **El rate limit es común, no por direcciones.** Los contadores son globales, pero solo cuentan peticiones con token válido: sin él, la petición cae en 401 antes de la comprobación del límite y no gasta cuota; la conexión SSE tampoco se abre. Mientras el token solo lo sepas tú, el límite no se nota. Si el token se filtra, los arranques ajenos consumen la cuota común y tu presupuesto LLM — se arregla cambiando el token, no ajustando los límites.
- **El servidor no termina TLS.** El HTTPS es tarea del reverse-proxy que va delante.
- **El token no se puede revocar en parte.** Es uno solo. Tras cambiarlo, actualiza `config.json` en cada dispositivo (basta sustituir el archivo en `dist` y recargar la extensión).
- **yt-dlp pide un runtime de JS.** En los logs se ve `No supported JavaScript runtime could be found ... has been deprecated`. Los subtítulos se descargan igualmente, comprobado. Si YouTube empieza a servir menos datos, pon `deno` junto a yt-dlp (en el sistema o en la imagen).
- **Los resúmenes viven en el navegador.** El servidor no guarda nada, así que al reinstalar el navegador o cambiar de dispositivo el historial no se traslada. Guarda en `.md` lo que quieras conservar.

## Licencia

MIT.
