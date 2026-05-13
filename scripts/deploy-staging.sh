#!/usr/bin/env bash
# Сборка + push + деплой ревизии на STAGING.
#
# Использование:
#   scripts/deploy-staging.sh <версия>
#   scripts/deploy-staging.sh 1.8
#
# Образ будет cr.yandex/.../3xproduction:test-v1.8
# Контейнер xproduction-test, БД 3xproduction_staging.
#
# Перед запуском — закоммить изменения, иначе попадёт грязное состояние.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <версия>  (например: 1.8 -> :test-v1.8)" >&2
  exit 2
fi

REGISTRY="cr.yandex/crp71f1brhdu87cfbr2i/3xproduction"
TAG="test-v${VERSION}"
IMAGE="${REGISTRY}:${TAG}"

CONTAINER_NAME="xproduction-test"
SERVICE_ACCOUNT="ajedo095fa8423ft92om"
NETWORK_ID="enpib623e5laqanui28p"
STAGING_URL="https://bbah7mhjte9so90t8760.containers.yandexcloud.net"

PROD_SECRETS_ID="e6qrgc50lab4ll7e7lig"
# Версия prod-secrets — обновлена 2026-04-30: добавлены REMBG_URL и REMBG_SECRET.
PROD_SECRETS_VER="e6ql8rotr793rvoqaf8t"
STAGING_SECRETS_ID="e6q7r9n4ur0tvis5gvdm"
STAGING_SECRETS_VER="e6qcrijrh1pmmb2l7esh"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo ">>> [1/3] Сборка $IMAGE с BUILD_MODE=staging (--no-cache)"
docker build --no-cache --build-arg BUILD_MODE=staging -t "$IMAGE" .

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
  --environment "FRONTEND_URL=${STAGING_URL}" \
  --environment "NODE_ENV=production" \
  --environment "S3_BUCKET_NAME=3xproduction-files" \
  --environment "S3_ENDPOINT=https://storage.yandexcloud.net" \
  --environment "S3_PUBLIC_URL=https://storage.yandexcloud.net/3xproduction-files" \
  --environment "S3_REGION=ru-central1" \
  --secret "environment-variable=DATABASE_URL,id=${STAGING_SECRETS_ID},version-id=${STAGING_SECRETS_VER},key=DATABASE_URL" \
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
HEALTH=$(curl -4 -s --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${STAGING_URL}/health" || echo "fail")
TITLE_LINE=$(curl -4 -s --connect-timeout 10 --max-time 30 "${STAGING_URL}/" | grep -i title | head -1 || true)
MANIFEST=$(curl -4 -s --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${STAGING_URL}/manifest.webmanifest" || echo "fail")

echo "  /health              -> ${HEALTH}"
echo "  / (title)            -> ${TITLE_LINE}"
echo "  /manifest.webmanifest -> ${MANIFEST}"

echo ""
echo ">>> Готово. Staging: ${STAGING_URL}"
