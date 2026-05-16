# CLAUDE.md

> Новая сессия: прочитай `C:\Users\Editor08\wiki\schema\index.md` и только профильные страницы из `C:\Users\Editor08\wiki\wiki\` по задаче. Если контекст уже загружен — не перечитывай CLAUDE.md и wiki целиком на каждую мелкую правку.

## Источник истины

**Единый источник истины — этот `CLAUDE.md` + `C:\Users\Editor08\wiki\`.** `CODEX.md` удалён (был вторым конфликтующим доком и отставал от реальности на несколько версий).

**Состояние деплоя (версии/ревизии prod и staging) НЕ берётся из доков** — любой снапшот в файлах = «не позднее чем». Точное состояние всегда сверять живым облаком:

```bash
yc serverless container revision list --container-name xproduction        # prod
yc serverless container revision list --container-name xproduction-test   # staging
```

Общие принципы: dirty worktree — не источник shipped-истины; committed-состояние — через `git show HEAD:<path>`; staging и prod — разные линии тегов (`test-vN` ≠ авто prod `vN`).

## Deploy (простой, без ритуала)

Лёгкая модель — одна команда, без обязательного review-gate:

```bash
bash scripts/deploy-staging.sh <ver>   # → :test-v<ver>, build --no-cache + push + revision + smoke
bash scripts/deploy-prod.sh   <ver>    # → :v<ver>, то же + интерактивное yes-подтверждение
```

- **Прокси Anthropic ЖЁСТКО зашит в обоих скриптах.** Контейнер в РФ-egress: прямой `api.anthropic.com` гео-блок (403) роняет все AI-фичи. Ничего экспортить/переопределять перед деплоем НЕ нужно — ритуал убран.
- **test → prod:** ВСЕГДА сначала staging; прод — только по явной отмашке пользователя, каждый раз отдельно (не переносится на следующий деплой).
- **Review-gate удалён полностью** (Codex/Claude review-сабсистема, `.codex/`, `*review*.ps1`, `gate`, guarded-обёртки — всё снято за неактуальностью). Claude в этом проекте ВСЕГДА исполнитель (пишет код, деплоит), не ревьюер. Никакого вердикта/пакета ждать не нужно.
- `docker push` сам по себе ничего не деплоит — нужна `revision deploy` (это делает скрипт). `npm run deploy:staging -- <ver>` / `deploy:prod -- <ver>` — обёртки над теми же `.sh`.
- Деплой-детали (env, секреты Lockbox, smoke, откат) — `C:\Users\Editor08\wiki\wiki\deployment.md`.

## Миграции и prod-БД (корень прошлых 502)

- **НИКОГДА не запускать миграции на старте контейнера (boot-migrate).** Прод подняли ДО трекинга миграций → прод-`_migrations` неполная → boot-migrate переигрывает неидемпотентные 001–066 → крэш → prod 502. Dockerfile CMD = только `node backend/src/index.js`.
- Новые миграции (`>=067`) применяются ВНЕ деплоя изолированным одноразовым job — `backend/scripts/db-job.js` (in-VPC, только `>=067`, одна транзакция, ROLLBACK при изменении остатков).
- Фундаментальный фикс (разовая сверка prod-`_migrations`: пометить 001–066 applied без выполнения) — `backend/scripts/reconcile-migrations.js`, режимы `audit`/`apply`, только tracking-таблица, guard по бизнес-счётчикам. **Отложен** до поднятого Docker (делать безопасным in-VPC job-контейнером, НЕ toggle-ингом public-IP).
- Prod-БД/YC/Object Storage/Container Registry — любые изменения только по явному OK + обязательный бэкап прод-БД заранее. Toggle public-IP прод-PG рискован (cold-start 502 на проде/стейдже в окне реконфига) — путь через изолированный in-VPC job предпочтительнее public-IP.

## Project

3XMedia Production — SPA для склада реквизита и production-процессов. Стек: Node.js/Express 5/CommonJS, PostgreSQL, React 19, Vite, Docker/Yandex Cloud.

Committed HEAD содержит PWA/prod hardening, pino logger, FTS-поиск с синонимами, warehouse cells v2, проектные склады, склады коллег, межпроектные займы, handover-акты, публичную аренду, возвраты, долги, пересорт, списания, AI-распознавание фото и поддержку видео как медиа.

## Commands

```powershell
cd C:\Users\Editor08\Desktop\3xproduction
npm.cmd run build
npm.cmd start

cd backend
npm.cmd run dev
npm.cmd run migrate

cd ..\frontend
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
```

На Windows использовать `npm.cmd`, не `npm`.

## Architecture

```text
backend/src/
  index.js                 Express routes/static, helmet/CORS/rate-limit
  logger.js                pino/pino-http, sensitive redact
  db/migrations/           committed migrations 001-069 (069 — последняя на ветке)
  routes/                  units, projectUnits, colleagues, handovers, rent, publicRent, search, etc.
frontend/src/
  App.jsx                  router, warehouse/production worlds
  components/warehouse/    catalog, cells, returns, misplaced, writeoffs
  components/production/   project warehouse hub, colleagues, handovers
  components/shared/       UnitCardModal, PublicUnitCardModal, Toast, SectionTabs
  services/api.js          central API client
```

Два мира: Warehouse (`warehouse_director`, `warehouse_deputy`, `warehouse_staff`) и Production (`producer`, `project_director`, creative/project roles). JWT для API идёт через `X-Auth-Token`.

## Important Areas

- Search: `backend/src/services/searchService.js`, `routes/search.js`, `routes/units.js`; migrations `034-038`; `pg_trgm/unaccent` нельзя считать доступными на Yandex Managed PostgreSQL.
- Project warehouse: `routes/projectUnits.js`; project-kept units `is_project_kept=true`. `GET /project-units` — UNION 3 источников (`own` / `from_warehouse` / `from_project`) с фильтром `?source=`. Купленные проектом — `purchased=true`; warehouse-сводка по ним — `GET /project-units/purchased-by-projects` (модуль «Куплено» на дашборде).
- Colleagues/loans: `routes/colleagues.js`, `project_loan_requests`, `LoanRequestsSection`.
- Handovers: `routes/handovers.js`, `HandoversPage`, tab in `ProjectWarehouseHub`.
- Warehouse map: `frontend/src/components/warehouse/cells/*`, `routes/warehouses.js`, migrations `039`, `051`, `054`, `055`.
- Public rent: `routes/publicRent.js`, `routes/rent.js`, `PublicWarehousePage`, `PublicUnitCardModal`.
- PWA/logging: `frontend/public/manifest.webmanifest`, `sw.js`, `frontend/src/main.jsx`, `backend/src/logger.js`.

## Rules

- Do not overwrite unrelated dirty changes.
- Do not document uncommitted WIP as shipped.
- Add DB changes only through idempotent SQL migrations.
- Keep backend/frontend roles and permissions synchronized.
- Use `backend/src/logger.js`; avoid new `console.log` in production code.
- Add new API calls to `frontend/src/services/api.js`.
- Prod deploy, production DB, Object Storage, Container Registry and YC infra require explicit user OK.
- `docker push` alone does not deploy a Serverless Container revision.

## Testing

There are no full unit/integration tests. Minimum frontend/fullstack check:

```powershell
cd C:\Users\Editor08\Desktop\3xproduction\frontend
npm.cmd run lint
npm.cmd run build
```

Backend-only:

```powershell
cd C:\Users\Editor08\Desktop\3xproduction\backend
npm.cmd run migrate
npm.cmd start
```
