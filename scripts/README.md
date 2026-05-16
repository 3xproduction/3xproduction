# scripts/

Обёртки над YC CLI / Docker — чтобы не вводить длинные команды руками и не забыть критичные шаги (`--no-cache`, выключение публичного IP).

| Скрипт | Назначение |
|---|---|
| `deploy-staging.sh <ver>` | Сборка `:test-v<ver>` + push + ревизия в `xproduction-test` + smoke-тест |
| `deploy-prod.sh <ver>` | То же для prod (с подтверждением `yes` и чек-листом) |
| `with-prod-pg-access.sh '<cmd>'` | Включает публичный IP у prod-PG, выполняет команду, **гарантированно** выключает (trap EXIT) |

## Запуск

Все скрипты — bash (Git Bash / WSL). Из корня проекта:

```bash
bash scripts/deploy-staging.sh 1.8
bash scripts/deploy-prod.sh 1.3
bash scripts/with-prod-pg-access.sh 'docker exec ...'
```

Или сделать исполняемыми один раз:
```bash
chmod +x scripts/*.sh
./scripts/deploy-staging.sh 1.8
```

## Зависимости в PATH

- `docker` (Docker Desktop запущен)
- `yc` (Yandex Cloud CLI, авторизован: `yc config list`)
- `curl`, `nslookup` (есть в Git Bash из коробки)

## Примеры

**Дамп прода в локалку — безопасно:**
```bash
bash scripts/with-prod-pg-access.sh '
  docker run --rm --add-host=$PROD_HOST:$PROD_IP \
    -e PGPASSWORD="<пароль app_readonly>" -e PGSSLMODE=require \
    postgres:16 pg_dump --no-owner --no-privileges \
    -h $PROD_HOST -p 6432 -U app_readonly -d 3xproduction
' > prod-dump.sql
```
Если что-то упадёт или нажмёшь Ctrl+C — публичный IP всё равно выключится через trap.

**UPDATE пароля юзера в проде:**
```bash
HASH=$(cd backend && node -e "console.log(require('bcrypt').hashSync('новый_пароль', 12))")
bash scripts/with-prod-pg-access.sh "
  docker run --rm --add-host=\$PROD_HOST:\$PROD_IP \
    -e PGPASSWORD='<пароль app>' -e PGSSLMODE=require postgres:16 \
    psql -h \$PROD_HOST -p 6432 -U app -d 3xproduction \
    -c \"UPDATE users SET password_hash = '$HASH' WHERE email = 'user@example.com';\"
"
```

## Что делать если деплой упал на полпути

- На этапе `docker build` — починить ошибку и перезапустить, ничего не задеплоено.
- На этапе `docker push` — проверить `yc container registry configure-docker`, перезапустить.
- На этапе `revision deploy` — старая ревизия продолжает обслуживать трафик. Откатить новую через YC Console (см. wiki/deployment.md).

## Review-gate удалён

Codex/Claude review-сабсистема (`.codex/`, `*review*.ps1`, `pre-deploy-check.ps1`,
guarded-обёртки, npm `review*`/`gate`/`deploy:*:guarded`) снята за неактуальностью.
Claude в этом проекте — исполнитель, не ревьюер. Деплой = напрямую `bash
scripts/deploy-staging.sh <ver>` (или `npm.cmd run deploy:staging -- <ver>`),
без обязательной проверки. Единый источник истины — `CLAUDE.md` + `C:\Users\Editor08\wiki\`.
