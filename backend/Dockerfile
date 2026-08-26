FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
# yt-dlp — бинарник для скачивания субтитров (ставится через pip, нужен python3).
# Чистит транскрипт TS-порт cleanTranscript.ts — Python в рантайме не нужен.
RUN apk add --no-cache python3 py3-pip ffmpeg \
 && pip install --no-cache-dir --break-system-packages -U yt-dlp
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /tmp/digest
RUN addgroup -S app && adduser -S -G app -u 1001 appuser && chown -R appuser:app /tmp/digest
USER appuser
CMD ["node", "dist/main.js"]
