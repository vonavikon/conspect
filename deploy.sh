#!/usr/bin/env bash
# Деплой conspect на skrime-main (Сервис-стандарт W2, паттерн deploy.sh v2)
# Заливка только закоммиченного (git ls-files) — всё дерево репо (backend/, extension/, scripts/);
# compose-проект и build-контекст живут в backend/ (сервер-факт: /opt/conspect/backend,
# compose-сервис называется backend, контейнер — conspect-backend).
# Снапшот прода до заливки, сверка серверных хотфиксов (md5), build --pull, up -d, verify.
# Запуск: с раннера GH Actions (ключ SKRIME_DEPLOY_KEY, юзер deploy) или локально.
# Репо публичный: адрес сервера нигде не захардкожен (алиас skrime-main,
# HostName задаётся в ~/.ssh/config раннера из секрета SKRIME_DEPLOY_HOST).
set -euo pipefail

HOST="${HOST:-deploy@skrime-main}"
REMOTE=/opt/conspect
COMPOSE_DIR=backend
SERVICE=backend
KEEP_SNAPSHOTS=5
EXCLUDE='^(backups/|\.env)$'

cd "$(git rev-parse --show-toplevel)"
FILES=$(git ls-files | grep -vE "$EXCLUDE")
SHA=$(git rev-parse --short HEAD)

echo "==> [1/4] hotfix-детект: сверяю $REMOTE с репо ($SHA)"
SUMS=$(md5sum $FILES)
DIFF=$(ssh "$HOST" "cd $REMOTE && md5sum -c - --quiet 2>/dev/null || true" <<<"$SUMS" || true)
if [ -n "$DIFF" ]; then
  echo "!! На сервере файлы отличаются от репо (возможные хотфиксы):"
  echo "$DIFF"
  echo "!! Они будут перезаписаны; снапшот ниже их сохранит. Ctrl+C для отмены."
else
  echo "    сервер совпадает с репо"
fi

echo "==> [2/4] снапшот прода"
STAMP=$(date +%Y%m%d-%H%M%S)
ssh "$HOST" "cd $REMOTE && mkdir -p backups && tar czf backups/pre-deploy-${STAMP}.tar.gz --exclude='backups' --exclude='data' --exclude='logs' --exclude='.git' . \
  && ls -1t backups/pre-deploy-*.tar.gz | tail -n +$((KEEP_SNAPSHOTS + 1)) | xargs -r rm -f && echo snapshot ok"

echo "==> [3/4] заливка -> $HOST:$REMOTE (всё дерево репо, build-контекст $COMPOSE_DIR/)"
tar czf - --files-from=- <<<"$FILES" | ssh "$HOST" "tar xzf - -C $REMOTE"

echo "==> [4/4] build + up + verify (compose-проект из $COMPOSE_DIR/, имя проекта = backend — как на проде)"
ssh "$HOST" "cd $REMOTE/$COMPOSE_DIR && docker compose build --pull && docker compose up -d $SERVICE \
  && sleep 5 && docker compose ps --format '{{.Name}}\t{{.Status}}' \
  && echo '--- logs ---' && docker compose logs --tail=15 --no-color $SERVICE 2>&1"
echo "Деплой $SHA завершён."
