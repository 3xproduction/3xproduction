# CODEX.md

> Новая Codex-сессия: сначала прочитай этот файл из корня проекта, затем `C:\Users\Editor08\wiki\schema\index.md` и только профильные страницы из `C:\Users\Editor08\wiki\wiki\` по задаче. Если сессия уже открыта и контекст загружен, не перечитывай wiki целиком перед каждой маленькой правкой.

## Committed Baseline

Документ обновлён 2026-05-15 после staging/prod-релиза. Актуальная ветка: `wip/admin-stock-2026-05-12-split`.

```text
HEAD: 080648d 2026-05-15 feat: в приглашении участника продюсером — выбор проекта перед ролью
релиз 2026-05-15 (на ветке, не в main):
  632f9f0 feat: площадка — источник первым шагом визарда + дубль-чек, синхрон «Выдано» с Движением
  dad7cbd fix: дефолт Anthropic baseURL на прокси (гео-403)
  99d681c chore: log effective Anthropic baseURL host (диагностика)
  6cdade0 feat: визард — цена/дата/период на шаг 3; модуль «Куплено у проектов»
  080648d feat: invite — выбор проекта перед ролью
```

Для проверки committed-состояния используй `git log`, `git show HEAD:<path>` и committed diff. Не использовать dirty worktree как источник shipped-контекста.

## Active Deployment Snapshot

Последний пользовательски подтверждённый cloud-релиз: 2026-05-15.

```text
staging xproduction-test: test-v2.91, revision bba8grflihavd44n6c4r
prod    xproduction:      v2.81,      revision bbaq1mq9kl021npdnqtt
backup before prod (этой сессии): c9q6s8unjudiha3iqeo6:mdblfj0fvjfbq36pm1pi, status DONE
предыдущий prod: v2.76, revision bbakbbc38oq4rfj7a5to (откат: активировать эту ревизию)
```

Smoke prod после деплоя: `/health=200`, `/=200`, `/manifest.webmanifest=200`; `/units/recognize=200` (AI распознавание подтверждено). Prod использует прокси: лог `[anthropic] effective baseURL host=anthropic-proxy.pavelbelov590.workers.dev`.

### Shipped scope релиза 2026-05-15

- **Визард площадки** (`AddUnitModal mode='project'`): шаг «Источник» (Куплено для проекта / С общего склада) — первым; при «С общего склада» после AI — блок похожих с общего склада (дубль-чек, логика как в пакетном пополнении, `frontend/src/utils/similarUnits.js`). «Цена/Дата покупки» и «Временное понятие» перенесены на шаг «Описание» (период заполняет AI отдельно). Админка и обычный склад — без изменений.
- **Модуль «Куплено у проектов»** на дашборде склада: KPI «Куплено» + карточка-список (формат как «заявки от проектов»/«вернули»). Backend `GET /project-units/purchased-by-projects` (warehouse/producer) — units с `purchased=true` + `project_id`, группировка по проектам. Это отдельная категория, НЕ «выдано складом».
- **Синхрон «Выдано»**: счётчик и список «Выданы» на главной у складских берутся из `GET /issued/by-projects?view=issued` (как раздел «Движение»), с тихим fallback.
- **Приглашение участника продюсером**: в модалке инвайта сначала выбор проекта, затем роли (бэк уже принимал `project_id`).
- **Fix AI гео-403**: `backend/src/services/anthropicClient.js` по умолчанию использует прокси (`https://anthropic-proxy.pavelbelov590.workers.dev`); прямой `api.anthropic.com` из YC всегда 403 «Request not allowed». Деплой-скрипты берут `ANTHROPIC_BASE_URL` из шелла — при агентском деплое ОБЯЗАТЕЛЬНО переопределять на прокси.

### Prod-DB изменения этой сессии (применены напрямую SQL, не миграцией)

- Удалены 3 пустых дубля проектов: «Закон тайги», «Опасный», «Шеф» (оригиналы — «Закон тайги-3», «Опасный-2», «Шеф-8»).
- Кудрявцева Юлия и Бартновская Варвара → роль `costume_designer` (single `users.project_id`: Юля — «Опасный-2», Варя — «Закон тайги-3»; «и Шеф, и Закон тайги» одновременно требует миграции many-to-many — не сделано).
- 21 единица (создана в Админке, `created_by=NULL`) → `is_project_kept=true`, `project_id`=«Опасный-2», затем `purchased=true`, `source='Покупка'` (видна в модуле «Куплено у проектов»).
- Staging-БД: тестовый `costume_designer` «Светлана Светланова» привязана к проекту «Наш Спецназ 4 сезон» (для теста кнопки «+»).

> **Сверка с миграциями 065/066** (applied 2026-05-14, до этой сессии; в `_migrations`, повторно НЕ запускаются): на текущем проде конфликта нет, дубли удалены окончательно, Юля/Варя/21 единица в верном состоянии. **Внимание:** `066_costume_designer_prod_finish.sql` содержит `INSERT INTO projects ('Опасный','Шеф','Закон тайги') WHERE NOT EXISTS` — на СВЕЖЕЙ БД (новое окружение/пересоздание) она снова насеет эти bare-name проекты и вернёт дубль-паттерн; на проде это уже отыграно и почищено вручную.

## Project

3XMedia Production — full-stack SPA для управления складом реквизита кинопроизводства и production-процессами.

Стек committed baseline: Node.js/Express 5/CommonJS, PostgreSQL, React 19, Vite, Docker/Yandex Cloud Serverless Containers, Yandex Managed PostgreSQL, Yandex Object Storage через S3-compatible API.

Крупные committed блоки на `HEAD`: PWA и production hardening, pino-логгер, умный поиск с синонимами и FTS, складская карта/секции, проектные склады, склады коллег и межпроектные займы, handover-акты проекта, публичный каталог аренды, заявки/выдачи/возвраты, долги, пересорт, списания, AI-распознавание фото, поддержка видео как медиа.

## First Steps

1. Убедиться, что открыт проект `C:\Users\Editor08\Desktop\3xproduction`.
2. Проверить `git status --short --branch`; рабочее дерево часто грязное.
3. Для документации committed-состояния смотреть только `git log`, `git show HEAD:<path>` и committed diff.
4. Прочитать `C:\Users\Editor08\wiki\schema\index.md`.
5. Если задача доменная, читать только профильную wiki:
   - API: `C:\Users\Editor08\wiki\wiki\api.md`
   - Архитектура: `C:\Users\Editor08\wiki\wiki\architecture.md`
   - Роли и auth: `C:\Users\Editor08\wiki\wiki\auth-system.md`
   - Деплой: `C:\Users\Editor08\wiki\wiki\deployment.md`
   - AI: `C:\Users\Editor08\wiki\wiki\ai-features.md`
   - Кастинг: `C:\Users\Editor08\wiki\wiki\casting.md`
   - Склад проекта: `C:\Users\Editor08\wiki\wiki\project-warehouse.md`
   - Обмен между проектами: `C:\Users\Editor08\wiki\wiki\inter-project-exchange.md`
   - Жизненный цикл единицы: `C:\Users\Editor08\wiki\wiki\unit-lifecycle.md`
   - Карта склада/секции: `C:\Users\Editor08\wiki\wiki\warehouse-map.md`
   - Решения и история: `C:\Users\Editor08\wiki\wiki\decisions.md`

## Repository

```text
3xproduction/
  backend/src/
    index.js                 # Express, helmet/CORS/rate-limit, routes, static frontend
    logger.js                # pino logger, added in 622c1f5
    middleware/auth.js       # JWT, role guard, impersonation
    db/                      # pg pool, migrate.js, migrations 001-066 in committed HEAD
    routes/                  # auth, units, warehouses, requests, issuances, rent, projectUnits, colleagues, handovers, etc.
    services/                # r2/S3, AI, pdf, notifications, search
    constants/storageRules.js
  frontend/src/
    App.jsx                  # React Router, world routes, prod/dev banners
    components/warehouse/    # warehouse UI, cells v2, returns/misplaced/writeoffs
    components/production/   # production UI, project warehouse hub, colleagues, handovers
    components/shared/       # modals, UnitCardModal, PublicUnitCardModal, Toast, TriixLogo
    hooks/
    services/api.js          # central API client
    constants/
  frontend/public/           # PWA icons, manifest.webmanifest, sw.js, triix-logo.png
```

## Local Setup

На Windows PowerShell используй `npm.cmd`, чтобы не упереться в execution policy.

```powershell
cd C:\Users\Editor08\Desktop\3xproduction
npm.cmd run build
npm.cmd start
```

Dev-режим:

```powershell
cd C:\Users\Editor08\Desktop\3xproduction\backend
npm.cmd run dev

cd C:\Users\Editor08\Desktop\3xproduction\frontend
npm.cmd run dev
```

Backend-only:

```powershell
cd C:\Users\Editor08\Desktop\3xproduction\backend
npm.cmd run migrate
npm.cmd start
```

## Environment

Обязательные backend env vars: `DATABASE_URL`, `JWT_SECRET`.

Опционально/по фичам: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, VAPID keys, `FRONTEND_URL`, `PORT`, S3/Object Storage переменные.

Yandex Object Storage:

```text
S3_ENDPOINT=https://storage.yandexcloud.net
S3_ACCESS_KEY_ID=<Yandex IAM static key>
S3_SECRET_ACCESS_KEY=<secret>
S3_BUCKET_NAME=<bucket>
S3_PUBLIC_URL=https://storage.yandexcloud.net/<bucket>
```

## Architecture Rules

- Два мира: Warehouse и Production. Всегда проверять layout, routes и роли.
- Warehouse roles: `warehouse_director`, `warehouse_deputy`, `warehouse_staff`.
- Production roles включают `producer`, `project_director`, `director`, `DOP`, props/costume/art roles, `ams_assistant` и другие.
- JWT в облаке должен идти через `X-Auth-Token`; `Authorization: Bearer` в Yandex Cloud может перехватываться.
- SQL-схема меняется только миграциями в `backend/src/db/migrations/`.
- Миграции должны быть идемпотентными и совместимыми с Yandex Managed PostgreSQL. Не рассчитывать на superuser-права и `CREATE EXTENSION`.
- Не менять роли/permissions только на frontend или только на backend.
- Не использовать dirty WIP как источник истины для документации committed-состояния.

## Latest Committed Changes

### PWA And Hardening

Commit `622c1f5`:

- PWA manifest, iOS/Android meta tags, app icons `192/512/180`.
- `frontend/public/sw.js` регистрируется в `frontend/src/main.jsx`.
- `DevEnvBanner` показывается в dev/staging, `ImpersonateBanner` скрыт в prod.
- `backend/src/logger.js` добавил pino/pino-http с redact чувствительных полей.
- Backend startup/db/migration/error logs переведены на structured logging.
- `backend/scripts/generate-pwa-icons.js` генерирует PWA icons через `sharp`.

### Production Sync

Commit `0589f53` синхронизировал git с уже работавшим production-кодом:

- импортированы миграции `035-055`;
- добавлены `projectUnits`, `colleagues`, `handovers`, `writeoffs`;
- обновлены `units`, `warehouses`, `rent`, `publicRent`, `search`, `analytics`, `issuances`;
- заменена старая карта склада на `frontend/src/components/warehouse/cells/*`;
- добавлены `ProjectWarehouseHub`, `ProjectWarehousePage`, `ColleaguesPage`, `HandoversPage`, `LoanRequestsSection`;
- добавлены `ReturnsPage`, `MisplacedPage`, `WriteoffsPage`, `PublicUnitCardModal`, `AddUnitModal`, `SectionTabs`, `TriixLogo`.

## Feature Notes

### Search System

Поиск основан на PostgreSQL `tsvector/tsquery` с русской морфологией и таблицей `search_synonyms`.

Ключевые committed файлы:

```text
backend/src/services/searchService.js
backend/src/routes/search.js
backend/src/routes/units.js
backend/src/routes/publicRent.js
frontend/src/hooks/useGlobalSearch.js
frontend/src/components/shared/GlobalSearchBar.jsx
frontend/src/components/warehouse/UnitsPage.jsx
frontend/src/components/production/WarehouseViewPage.jsx
```

Важно:

- `pg_trgm` и `unaccent` на Yandex Managed PostgreSQL ненадёжны из-за прав; использовать fallback-подходы.
- AI-теги имеют низкий вес D, чтобы не раздувать ложные совпадения.
- Миграция `032_full_text_search.sql` проблемная; committed инфраструктура поиска стабилизируется через `034-038`.
- Проверять поиск через `/search/debug?q=...`, если backend доступен.

### Warehouse Map

Committed карта склада живёт в `frontend/src/components/warehouse/cells/*`, а старые `CellsPage`/`CellConstructorPage` удалены. Роуты:

```text
/cells
/cells/:warehouseId
/cells/:warehouseId/type/:type
/cells/:warehouseId/hall/:hallId
/cells/:warehouseId/section/:sectionId
```

Backend: `backend/src/routes/warehouses.js`, миграции `039_section_layout`, `051_sections_rotation`, `055_sections_parent`, индекс `054_idx_units_cell_id`.

### Project Warehouse

Committed `GET /project-units` — UNION 3 источников: `own` (`is_project_kept=true`, `project_id`=мой), `from_warehouse` (выдано со склада, физически у проекта), `from_project` (одолжено у другого проекта). Каждая строка несёт `source` + метаданные; фильтр `?source=own|from_warehouse|from_project` и `?category=`. Это не публичный каталог и не общий склад. Купленные проектом единицы — `purchased=true` (бейдж «🛒 Куплено»).

Основные endpoints:

```text
GET  /project-units?project_id=&category=&source=own|from_warehouse|from_project
GET  /project-units/purchased-by-projects   # warehouse/producer: купленное проектами, группировка по проектам (дашборд «Куплено»)
POST /project-units
POST /project-units/upload-receipt
PUT  /project-units/:id
DELETE /project-units/:id
POST /project-units/:id/transfer-to-warehouse
POST /project-units/:id/return-to-project
GET  /project-units/pending-transfers
POST /project-units/:id/request-return
GET  /project-units/return-requests?direction=incoming|outgoing&status=
POST /project-units/return-requests/:id/confirm
POST /project-units/return-requests/:id/cancel
POST /project-units/:id/accept-transfer
POST /project-units/:id/reject-transfer
```

Роли:

- `PROJECT_WRITER_ROLES` могут добавлять/редактировать свой проектный склад.
- `warehouse_director`, `warehouse_deputy`, `producer` могут инициировать/подтверждать возвраты с проектных складов.
- `transfer-to-warehouse` в committed HEAD immediate: единица уходит из проекта на общий склад, с ячейкой или без места.

### Inter-Project Exchange

`backend/src/routes/colleagues.js` и `project_loan_requests` отвечают за склады коллег и временные займы между проектами.

UI:

```text
/production/project-warehouse?tab=my
/production/project-warehouse?tab=colleagues
/production/project-warehouse?tab=requests
/production/project-warehouse?tab=handovers
```

`ProjectWarehouseHub` скрывает лишние вкладки для warehouse-ролей и producer: им показывается обзор складов коллег/возвратов.

### Handovers

`backend/src/routes/handovers.js` создаёт handover-акт как snapshot project-kept единиц проекта. UI: `HandoversPage`, вкладка `Передача склада` в `ProjectWarehouseHub`.

Endpoints:

```text
POST /handovers
GET  /handovers?project_id=
GET  /handovers/:id
PUT  /handovers/:id/items/:itemId
POST /handovers/:id/sign
DELETE /handovers/:id
```

### Returns, Misplaced, Writeoffs

Committed warehouse страницы:

```text
/returns    -> frontend/src/components/warehouse/ReturnsPage.jsx
/misplaced  -> frontend/src/components/warehouse/MisplacedPage.jsx
/writeoffs  -> frontend/src/components/warehouse/WriteoffsPage.jsx
```

Backend:

```text
backend/src/routes/writeoffs.js
backend/src/routes/debts.js
backend/src/routes/issuances.js
backend/src/routes/projectUnits.js
```

Миграции: `046_writeoffs`, `048_units_misplaced`, `052_rent_return_requested`, `053_photo_history_links`.

### Public Rent

Committed публичный каталог живёт в `backend/src/routes/publicRent.js`, `backend/src/routes/rent.js`, `frontend/src/components/production/PublicWarehousePage.jsx`, `frontend/src/components/shared/PublicUnitCardModal.jsx`.

Есть публичные пользователи/кабинет, cart request, sign flow, pending review/workflow stage, запрос возврата публичной аренды. Миграции: `033_rent_pending_review`, `049_public_users`, `050_rent_workflow_stage`, `052_rent_return_requested`.

### Units And Media

`/units` поддерживает AI-распознавание фото, видео как media (`mp4/webm/quicktime`) и bulk-delete для director/deputy. AI не анализирует видео как видео; видео хранится и показывается как медиа, а распознавание делается по фото.

Критичные файлы:

```text
backend/src/routes/units.js
frontend/src/components/shared/AddUnitModal.jsx
frontend/src/components/shared/UnitCardModal.jsx
frontend/src/components/warehouse/UnitsPage.jsx
frontend/src/components/production/WarehouseViewPage.jsx
```

## Frontend Rules

- Чистый JS, TypeScript нет.
- React 19 + Vite, ESLint flat config.
- Использовать существующие shared-компоненты: `Button`, `ConfirmModal`, `Toast`, `Lightbox`, `UnitCardModal`, `PublicUnitCardModal`, `SectionTabs`.
- Иконки — `lucide-react`.
- Не ломать мобильные сценарии: sticky headers, нижние панели, popover без clipping.
- `api.js` — центральный клиент. Новые endpoints добавлять туда, а не размазывать `fetch`.
- `UnitCardModal` большой и критичный; менять точечно.

## Backend Rules

- Express 5, CommonJS.
- `backend/src/index.js` монтирует routes и раздаёт frontend static.
- Логгер: `backend/src/logger.js` на pino. Не добавлять `console.log` в production-код.
- Upload limits/MIME types проверять на backend.
- R2/S3 сервис работает с Yandex Object Storage: `backend/src/services/r2.js`.
- Push/email/AI должны безопасно деградировать, если env var не задан.

## Testing

Полноценных unit/integration тестов нет.

Минимальная проверка frontend/fullstack:

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

Если текущий lint уже красный до изменений, зафиксировать это в ответе и не смешивать массовую чистку lint с маленькой фичей.

## Deployment

В committed HEAD нет корневых deploy-helper скриптов; в dirty deployed snapshot есть `scripts/deploy-staging.sh`, `scripts/deploy-prod.sh`, `scripts/with-prod-pg-access.sh` и npm-обёртки `gate`/`deploy:staging:guarded`. Любые действия с Yandex Cloud, Container Registry, Serverless Container, production DB или Object Storage — только после явного подтверждения пользователя.

Общее правило: `docker push` сам по себе не обновляет Serverless Container; нужна новая revision deploy. Не использовать `latest` для production-релизов без явной команды.

## Git Rules

- Всегда смотреть `git status --short --branch` перед изменениями.
- В грязном worktree не откатывать чужие изменения.
- Для задач "обнови docs по committed изменениям" использовать `git show HEAD:<path>`.
- Не делать `git reset --hard`, `git checkout --` и массовые удаления без явного запроса.
- Не коммитить автоматически, если пользователь не попросил.

## Do Not

- Не деплоить prod без явного подтверждения.
- Не менять production infra или production DB без явного подтверждения.
- Не добавлять `.env` в git.
- Не создавать таблицы без миграции.
- Не менять роли/permissions несинхронно.
- Не добавлять `console.log` в production-код.
- Не документировать незакоммиченный WIP как shipped/committed функциональность.
- Не отправлять видео в Claude Vision как видео-анализ.

## When Stuck

Остановиться и спросить перед удалением данных, изменением ролей, миграционной стратегии, production deploy, действиями с Yandex Cloud, широким рефакторингом или финансовой/арендной логикой с неясным бизнес-сценарием.

В ответах пользователю кратко писать: что изменено, где, чем проверено, что осталось рискованным.
