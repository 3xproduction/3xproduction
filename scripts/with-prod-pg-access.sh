#!/usr/bin/env bash
# Включает публичный IP у prod-PG, выполняет команду, ГАРАНТИРОВАННО выключает доступ.
# Выключение через trap EXIT — отрабатывает даже при Ctrl+C, ошибке или выходе из shell.
#
# Использование:
#   scripts/with-prod-pg-access.sh '<bash-команда или путь к скрипту>'
#
# Пример (дамп прода в локалку):
#   scripts/with-prod-pg-access.sh 'docker run --rm \
#     --add-host=$PROD_HOST:$PROD_IP \
#     -e PGPASSWORD=$APP_RO_PASSWORD -e PGSSLMODE=require \
#     postgres:16 pg_dump --no-owner --no-privileges \
#     -h $PROD_HOST -p 6432 -U app_readonly -d 3xproduction > prod-dump.sql'
#
# Внутри команды доступны:
#   $PROD_HOST  — FQDN prod-PG хоста
#   $PROD_IP    — IPv4 после ресолвинга через 8.8.8.8 (для --add-host в docker)

set -euo pipefail

CLUSTER_NAME="postgresql467"
PROD_HOST="rc1b-t9plikhl8a7t6vco.mdb.yandexcloud.net"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 '<command>'" >&2
  echo "Команда выполнится с публичным IP к prod-PG, после — IP будет выключен." >&2
  exit 2
fi

CMD="$*"

disable_public_ip() {
  local rc=$?
  echo ""
  echo ">>> Выключаю публичный IP у $PROD_HOST..."
  if yc managed-postgresql hosts update "$PROD_HOST" \
       --cluster-name "$CLUSTER_NAME" --assign-public-ip=false --async; then
    echo ">>> OK. Применение займёт 1-3 мин в YC."
  else
    echo "!!! ВНИМАНИЕ: не удалось выключить публичный IP автоматически." >&2
    echo "!!! Срочно выключи вручную:" >&2
    echo "!!!   yc managed-postgresql hosts update $PROD_HOST \\" >&2
    echo "!!!     --cluster-name $CLUSTER_NAME --assign-public-ip=false --async" >&2
  fi
  exit "$rc"
}
trap disable_public_ip EXIT INT TERM

echo ">>> Включаю публичный IP у $PROD_HOST..."
yc managed-postgresql hosts update "$PROD_HOST" \
  --cluster-name "$CLUSTER_NAME" --assign-public-ip=true --async

echo ">>> Жду пока YC применит (до 180 сек)..."
for i in $(seq 1 36); do
  if PROD_IP=$(nslookup "$PROD_HOST" 8.8.8.8 2>/dev/null \
                | awk '/^Address: / && !/8\.8\.8\.8/ {print $2; exit}') \
     && [[ -n "${PROD_IP:-}" ]]; then
    echo ">>> Резолвится: $PROD_HOST -> $PROD_IP"
    break
  fi
  sleep 5
done

if [[ -z "${PROD_IP:-}" ]]; then
  echo "!!! Не дождался публичного IP за 180 сек. Проверь руками:" >&2
  echo "!!!   yc managed-postgresql hosts list --cluster-name $CLUSTER_NAME" >&2
  exit 1
fi

export PROD_HOST PROD_IP

echo ">>> Выполняю команду:"
echo ">>> $CMD"
echo ""
bash -c "$CMD"
