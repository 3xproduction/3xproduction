#!/usr/bin/env bash
# Одноразовый скрипт: переписывает описания всех юнитов на проде через AI.
# Все секреты передаются через env, не через command line — не светятся в echo обёртки.

set -euo pipefail

PROD_URL="https://bba4ljiv43ebopvbl4oh.containers.yandexcloud.net"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ">>> Достаю секреты из Lockbox prod-secrets..."
PAYLOAD=$(yc lockbox payload get prod-secrets --format json)

extract_key() {
  echo "$PAYLOAD" | awk -v k="\"$1\"" '
    BEGIN { found = 0 }
    /"key":/ { if (index($0, k)) found = 1; next }
    found && /"text_value":/ {
      sub(/.*"text_value":[ \t]*"/, "")
      sub(/"[ \t]*,?[ \t]*$/, "")
      print
      exit
    }
  '
}

export JWT_SECRET=$(extract_key "JWT_SECRET")
DATABASE_URL=$(extract_key "DATABASE_URL")

if [[ -z "$JWT_SECRET" || -z "$DATABASE_URL" ]]; then
  echo "!! Не удалось получить секреты из Lockbox" >&2
  exit 1
fi

export DB_USER=$(echo "$DATABASE_URL" | sed -E 's#^postgresql://([^:]+):.*#\1#')
export DB_PASS=$(echo "$DATABASE_URL" | sed -E 's#^postgresql://[^:]+:([^@]+)@.*#\1#')
export DB_NAME=$(echo "$DATABASE_URL" | sed -E 's#^postgresql://[^/]+/([^?]+).*#\1#')
export PROD_URL PROJECT_ROOT

echo ">>> Секреты получены (через env). БД: $DB_USER@.../$DB_NAME"

bash "$SCRIPT_DIR/with-prod-pg-access.sh" '
  set -e
  echo ">>> Получаю UUID warehouse_director из prod-БД..."
  DIRECTOR_ID=$(docker run --rm --add-host=$PROD_HOST:$PROD_IP \
    -e PGPASSWORD="$DB_PASS" -e PGSSLMODE=require postgres:16 \
    psql -h $PROD_HOST -p 6432 -U $DB_USER -d $DB_NAME -t -A \
    -c "SELECT id FROM users WHERE role='\''warehouse_director'\'' ORDER BY created_at LIMIT 1")

  if [[ -z "$DIRECTOR_ID" ]]; then
    echo "!! Не удалось получить UUID директора" >&2
    exit 1
  fi
  echo ">>> Director UUID: $DIRECTOR_ID"

  echo ">>> Выписываю временный JWT (10 мин TTL)..."
  cd "$PROJECT_ROOT/backend"
  TOKEN=$(DIRECTOR_ID="$DIRECTOR_ID" node -e "
    const jwt = require(\"jsonwebtoken\");
    console.log(jwt.sign({ id: process.env.DIRECTOR_ID }, process.env.JWT_SECRET, { expiresIn: \"10m\" }));
  ")
  if [[ -z "$TOKEN" ]]; then
    echo "!! JWT не выписан" >&2
    exit 1
  fi
  echo ">>> JWT длина: ${#TOKEN}"

  echo ">>> Дёргаю /units/admin/regen-descriptions (1-3 минуты)..."
  curl -sS -X POST "$PROD_URL/units/admin/regen-descriptions" \
    -H "authorization: Bearer $TOKEN" \
    -H "content-type: application/json" \
    -d "{\"scope\":\"all\",\"limit\":100}" \
    --max-time 280
  echo
  echo ">>> Готово."
'
