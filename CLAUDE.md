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

- **НИКОГДА не запускать миграции на старте контейнера (boot-migrate).** Это политика. (Раньше прод подняли ДО трекинга миграций → прод-`_migrations` была неполная → boot-migrate переигрывал неидемпотентные 001–066 → prod 502.) Dockerfile CMD = только `node backend/src/index.js`.
- **Прод-`_migrations` сверена (2026-05-16):** 001–066 помечены applied (data-уровень починен, `reconcile-migrations.js`). Класс «boot-migrate 502» устранён по данным, но политика «миграции вне деплоя» сохраняется. **Не повторять reconcile.**
- Коммитнутые миграции: **001–072**. Новые миграции (`>=067`) применяются ВНЕ деплоя безопасным in-VPC одноразовым job:
  1. `docker build -f Dockerfile.dbjob -t cr.yandex/crp71f1brhdu87cfbr2i/3xproduction:dbjobNN .` + `docker push` (минимальный образ, без фронта — быстро).
  2. `yc serverless container create --name xproduction-dbjob` (+`allow-unauthenticated-invoke`), `revision deploy` с `--image dbjobNN --network-id enpib623e5laqanui28p --secret DATABASE_URL=<prod|staging-secrets>`.
  3. `curl` URL контейнера → JSON: `backend/scripts/db-job.js` применяет все `>=67` отсутствующие в `_migrations` в ОДНОЙ транзакции, ROLLBACK при изменении `units_total/qty_sum/written_off`; печатает before/after.
  4. `yc serverless container delete --name xproduction-dbjob`.
  - **In-VPC = БЕЗ public-IP toggling** (через `--network-id`). public-IP путь медленный/флапает + рискует cold-start 502 — не использовать, если есть Docker.
- Prod-БД/YC/Object Storage/Container Registry — любые изменения только по явному OK + **обязательный свежий бэкап прод-БД заранее** (`yc managed-postgresql cluster backup postgresql467 --async`, дождаться `done`). Бизнес-данные миграциями не трогать (только tracking/идемпотентные правки под guard).

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
  db/migrations/           committed migrations 001-072 (072 — последняя)
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
- Warehouse map: `frontend/src/components/warehouse/cells/*`, `routes/warehouses.js`, migrations `039`, `051`, `054`, `055`. Зал = `warehouse_sections type='hall'`; дочерние секции (`shelf/hanger/place`) через `parent_section_id`; зал-вью показывает дочерние секции, не ячейки напрямую.
- **Зал ↔ проекты (M2M):** канонично — таблица `section_projects(section_id, project_id)` (миграция `072`, как `user_projects`): один зал может обслуживать несколько проектов. Текущее: 217→Опасный-2, **513→{Шеф-8, Закон тайги-3}**. `warehouse_sections.project_id` (миграция `070`) — легаси, **никаким кодом не потребляется** (организационная метка); реальная привязка единиц к проекту — через `units.project_id`+`is_project_kept`. Будущая логика «ячейка на художника по костюмам» должна опираться на `section_projects`.
- Project-kept единицы обычно без места (`cell_id=NULL`) → видны в складе проекта, но НЕ в зале. Разовое исключение (`071`): 21 ед. «Опасный-2» помещены в секцию «Временная вешалка» зала 217 (cell_id задан, `is_project_kept` сохранён) → видны и в зале 217, и в складе проекта.
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
