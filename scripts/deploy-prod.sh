#!/usr/bin/env bash
# Сборка + push + деплой ревизии на PROD.
#
# Использование:
#   scripts/deploy-prod.sh <версия>
#   scripts/deploy-prod.sh 1.3
#
# Образ будет cr.yandex/.../3xproduction:v1.3
# Контейнер xproduction, БД 3xproduction.
#
# ВАЖНО перед запуском:
#  1) Сделать бэкап prod-БД (YC Console -> postgresql467 -> Резервное копирование).
#  2) Сначала задеплоить эту версию на staging и прокликать.
#  3) Не в рабочее время — деплой = ~30 сек downtime.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <версия>  (например: 1.3 -> :v1.3)" >&2
  exit 2
fi

REGISTRY="cr.yandex/crp71f1brhdu87cfbr2i/3xproduction"
TAG="v${VERSION}"
IMAGE="${REGISTRY}:${TAG}"

CONTAINER_NAME="xproduction"
SERVICE_ACCOUNT="ajedo095fa8423ft92om"
NETWORK_ID="enpib623e5laqanui28p"
PROD_URL="https://bba4ljiv43ebopvbl4oh.containers.yandexcloud.net"

PROD_SECRETS_ID="e6qrgc50lab4ll7e7lig"
# Версия prod-secrets — обновлена 2026-04-30: добавлены REMBG_URL и REMBG_SECRET.
PROD_SECRETS_VER="e6ql8rotr793rvoqaf8t"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: refusing prod deploy from a dirty worktree." >&2
  echo "Commit, stash, or explicitly build from a reviewed tag before deploying prod." >&2
  git status --short >&2
  exit 1
fi

ANTHROPIC_ENV_ARGS=()
ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://anthropic-proxy.pavelbelov590.workers.dev}"
ANTHROPIC_ENV_ARGS+=(--environment "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}")
if [[ -n "${ANTHROPIC_PROXY_URL:-}" ]]; then
  ANTHROPIC_ENV_ARGS+=(--environment "ANTHROPIC_PROXY_URL=${ANTHROPIC_PROXY_URL}")
fi

echo ""
echo "==================================================="
echo " ВНИМАНИЕ: ДЕПЛОЙ В PROD"
echo " Контейнер: $CONTAINER_NAME"
echo " Образ:     $IMAGE"
echo "==================================================="
echo ""
echo " Чек-лист:"
echo "   [ ] Бэкап prod-БД сделан?"
echo "   [ ] Эта версия проверена на staging?"
echo "   [ ] Сейчас не пиковое время?"
echo ""
if [[ "${PROD_DEPLOY_CONFIRMED:-}" == "yes" ]]; then
  echo " Продолжить деплой? yes (guarded wrapper)"
else
  read -r -p " Продолжить деплой? (yes/no): " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Отменено."
    exit 1
  fi
fi

echo ">>> [1/3] Сборка $IMAGE (--no-cache, BUILD_MODE=production)"
docker build --no-cache --build-arg BUILD_MODE=production -t "$IMAGE" .

echo ">>> [2/3] Push $IMAGE"
docker push "$IMAGE"

echo ">>> [3/3] Деплой ревизии в $CONTAINER_NAME"
yc serverless container revision deploy \
  --container-name "$CONTAINER_NAME" \
  --image "$IMAGE" \
  --cores 1 --core-fraction 100 --memory 1GB \
  --concurrency 4 --execution-timeout 300s \
  --service-account-id "$SERVICE_ACCOUNT" \
  --network-id "$NETWORK_ID" \
  --environment "FRONTEND_URL=${PROD_URL}" \
  --environment "NODE_ENV=production" \
  --environment "S3_BUCKET_NAME=3xproduction-files" \
  --environment "S3_ENDPOINT=https://storage.yandexcloud.net" \
  --environment "S3_PUBLIC_URL=https://storage.yandexcloud.net/3xproduction-files" \
  --environment "S3_REGION=ru-central1" \
  "${ANTHROPIC_ENV_ARGS[@]}" \
  --secret "environment-variable=DATABASE_URL,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=DATABASE_URL" \
  --secret "environment-variable=JWT_SECRET,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=JWT_SECRET" \
  --secret "environment-variable=ANTHROPIC_API_KEY,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=ANTHROPIC_API_KEY" \
  --secret "environment-variable=RESEND_API_KEY,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=RESEND_API_KEY" \
  --secret "environment-variable=S3_ACCESS_KEY_ID,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=S3_ACCESS_KEY_ID" \
  --secret "environment-variable=S3_SECRET_ACCESS_KEY,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=S3_SECRET_ACCESS_KEY" \
  --secret "environment-variable=VAPID_PUBLIC_KEY,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=VAPID_PUBLIC_KEY" \
  --secret "environment-variable=VAPID_PRIVATE_KEY,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=VAPID_PRIVATE_KEY" \
  --secret "environment-variable=REMBG_URL,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=REMBG_URL" \
  --secret "environment-variable=REMBG_SECRET,id=${PROD_SECRETS_ID},version-id=${PROD_SECRETS_VER},key=REMBG_SECRET"

echo ""
echo ">>> Smoke-тест"
HEALTH=$(curl -4 -s --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${PROD_URL}/health" || echo "fail")
TITLE_LINE=$(curl -4 -s --connect-timeout 10 --max-time 30 "${PROD_URL}/" | grep -i title | head -1 || true)
MANIFEST=$(curl -4 -s --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${PROD_URL}/manifest.webmanifest" || echo "fail")

echo "  /health              -> ${HEALTH}"
echo "  / (title)            -> ${TITLE_LINE}"
echo "  /manifest.webmanifest -> ${MANIFEST}"

echo ""
echo ">>> Готово. Prod: ${PROD_URL}"
echo ">>> Откат: YC Console -> Serverless Containers -> ${CONTAINER_NAME} -> ревизии -> Сделать активной."
