# CLAUDE.md

> Новая Claude/Codex-сессия: один раз прочитай `CODEX.md` в корне проекта, затем `C:\Users\Editor08\wiki\schema\index.md` и только профильные wiki-страницы по задаче. Если контекст уже загружен, не перечитывай `CLAUDE.md`, `CODEX.md` и wiki на каждое ревью.

## Baseline

**Единый источник истины по состоянию проекта — `CODEX.md`** (разделы «Committed Baseline», «Active Deployment Snapshot», «Shipped scope», «Prod-DB изменения»). Здесь baseline НЕ дублируется, чтобы не было рассинхрона: актуальные версии prod/staging, ревизии, что задеплоено и что менялось в prod-БД — всегда смотри в `CODEX.md`. Этот файл (`CLAUDE.md`) содержит только Claude-специфичные правила работы (команды, архитектура, do/don't).

Общие принципы: не использовать dirty worktree как источник shipped-контекста; committed-состояние — через `git show HEAD:<path>`; staging и prod — разные линии тегов (`test-vN` ≠ авто prod `vN`).

> Деплой: ВСЕГДА сначала staging, прод — только по явной отмашке пользователя (каждый раз отдельно). Скрипты деплоя берут `ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-<прокси>}"` — если в шелле экспортнут `api.anthropic.com`, его НАДО переопределять на прокси (`ANTHROPIC_BASE_URL='https://anthropic-proxy.pavelbelov590.workers.dev'` перед `bash scripts/deploy-*.sh`), иначе прод/стейдж AI падает с гео-403.

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
  db/migrations/           committed migrations 001-066
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
