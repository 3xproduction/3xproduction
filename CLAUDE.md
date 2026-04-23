# CLAUDE.md

> В начале каждой сессии первым делом читай `~/wiki/schema/index.md` чтобы восстановить полный контекст по проекту. После прочтения кратко подтверди что контекст загружен.

## Project
Full-stack SPA для управления складом реквизита кинопроизводства. Стек: Node.js (Express 5) + PostgreSQL + React 19 + Vite. Деплой через Docker на Яндекс Клауд (Yandex Serverless Containers / Container Registry).

## Setup
```bash
# Установка зависимостей и сборка
npm run build            # устанавливает deps и собирает frontend

# Dev-режим (два терминала)
cd backend && npm run dev        # backend на :3000 с --watch
cd frontend && npm run dev       # Vite dev-server

# Production
node backend/src/index.js        # или через Docker
```
**Переменные окружения** (скопировать `backend/.env.example`):
`DATABASE_URL`, `JWT_SECRET` — обязательны. Опционально: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, S3-переменные (5 штук), VAPID-ключи, `FRONTEND_URL`, `PORT`.

**Яндекс Клауд — переменные для Object Storage (вместо S3/R2):**
```
S3_ENDPOINT=https://storage.yandexcloud.net
S3_ACCESS_KEY_ID=<Yandex IAM статический ключ>
S3_SECRET_ACCESS_KEY=<секрет ключа>
S3_BUCKET_NAME=<имя бакета>
S3_PUBLIC_URL=https://storage.yandexcloud.net/<имя бакета>
```
Object Storage совместим с AWS S3 API — `backend/src/services/r2.js` работает без изменений.

**Яндекс Клауд — деплой:**
```bash
# Сборка и пуш образа в Container Registry
docker build -t cr.yandex/<registry-id>/<image>:<tag> .
docker push cr.yandex/<registry-id>/<image>:<tag>

# Переменные окружения задаются в настройках Serverless Container
# или через Yandex Lockbox (секреты)
```
БД: Yandex Managed Service for PostgreSQL. Строка подключения вида:
`postgresql://user:password@<cluster-host>:6432/dbname?sslmode=require`

## Testing
Тестов нет. Нет jest/vitest-конфигов. Линтер для frontend: `cd frontend && npm run lint` (ESLint flat config).

## Architecture
```
3xproduction/
├── backend/src/
│   ├── index.js          # точка входа, монтирует роуты, запускает миграции
│   ├── middleware/auth.js # JWT + role guard + impersonation
│   ├── db/               # pg pool, migrate.js, 38 SQL-миграций
│   ├── routes/           # auth, units, warehouses, requests, issuances,
│   │                     # documents, rent, analytics, team, lists, debts, search
│   └── services/         # r2 (S3), groq (Claude AI), resend (email), push, pdf, docParser, searchService
├── frontend/src/
│   ├── App.jsx           # React Router: PrivateRoute / WarehouseRoute / ProductionRoute
│   ├── components/       # warehouse/, production/, auth/, movement/, rent/, shared/
│   ├── hooks/useAuth.jsx # AuthContext (token + user в localStorage)
│   ├── services/api.js   # централизованный fetch-клиент
│   └── constants/        # roles.js, statuses.js, categories.js
└── Dockerfile            # multi-stage: build frontend → serve через Express
```
**Два мира:** Warehouse (director / deputy / staff) и Production (20+ ролей: producer, director, DOP и т.д.).
БД: PostgreSQL, миграции запускаются автоматически при старте сервера.

## Code Style
- TypeScript не используется (чистый JS). ESLint только на frontend.
- `varsIgnorePattern: ^[A-Z_]` — переменные в верхнем регистре можно объявлять без использования.
- Нет prettier-конфига — форматирование не стандартизировано.

## Do Not
- Не используй `console.log` в production-коде — добавь логгер (его нет, предложи `pino`).
- Не пиши SQL напрямую в роутах — выноси в отдельные query-функции или `db/index.js`.
- Не добавляй новые таблицы без SQL-миграции в `backend/src/db/migrations/`.
- Не меняй схему ролей в `constants/roles.js` без синхронизации с `middleware/auth.js`.
- Не коммить `.env` — используй `.env.example`.

## Commands
| Команда | Описание |
|---|---|
| `npm run build` | Установка deps + сборка frontend |
| `npm start` | Запуск production-сервера |
| `cd backend && npm run dev` | Backend в watch-режиме |
| `cd frontend && npm run dev` | Frontend dev-сервер (Vite) |
| `cd backend && npm run migrate` | Применить миграции вручную |
| `cd frontend && npm run lint` | ESLint проверка frontend |
| `docker build -t cr.yandex/...` | Собрать Docker-образ для YC |
| `docker push cr.yandex/...` | Запушить образ в Yandex Container Registry |

## Search System

Трёхуровневый полнотекстовый поиск на PostgreSQL `tsvector/tsquery` с русской морфологией (`ru_search` конфиг).

### Архитектура
```
Пользователь вводит запрос
        ↓
  searchService.buildSearchQuery()
    1. expandWithSynonyms(term) → { close, category, all }
       - close:    прямые синонимы (нож → кинжал, стилет)
       - category: siblings из той же категории (нож → пистолет, автомат)
    2. Строит tsquery: ('нож':* | 'кинжал' | 'стилет' | 'пистолет' | ...)
       - Введённое слово → prefix :* (для частичного ввода)
       - Синонимы → exact match (без :*, чтобы "нож" не ловил "ножки")
        ↓
  PostgreSQL FTS
    - search_vector @@ to_tsquery + ts_rank_cd > 0.5 (порог отсечения)
    - OR u.name ILIKE '%query%' (fallback для прямого совпадения по имени)
        ↓
  Три уровня результатов (_match field):
    - 'direct'  → название содержит введённое слово
    - 'similar' → название содержит close-синоним
    - 'related' → всё остальное (из той же категории)
        ↓
  Frontend: 3 секции с разделителями "Похожее" / "Из категории"
```

### search_vector (веса)
| Вес | Поля | Score |
|-----|-------|-------|
| A (высший) | name | ~1-5 |
| B | serial, category | ~0.5-1 |
| C | description, condition | ~0.1-0.5 |
| D (низший) | search_tags (AI), period, dimensions, source | ~0.01-0.1 |

AI-теги намеренно на весе D — они содержат 100+ слов на единицу и создают ложные совпадения на весе B.

### Синонимы
- Таблица `search_synonyms`: ~1000 групп, ~6-60 синонимов на группу
- Категории: furniture, clothing_main/outer, tableware, weapons_melee/ranged, electronics, tools, medical, lighting, decor, textile, и др.
- Мета-категория `meta`: зонтичные термины (одежда, мебель, посуда) — работают только при прямом поиске, не при обратном lookup
- Перекрёстные ссылки: чашка ↔ стакан ↔ кружка, нож ↔ кинжал, куртка ↔ пальто

### Ключевые файлы
| Файл | Роль |
|------|------|
| `backend/src/services/searchService.js` | expandWithSynonyms, buildSearchQuery, searchAll, checkTrgm |
| `backend/src/routes/search.js` | GET /search (глобальный) + GET /search/debug (диагностика) |
| `backend/src/routes/units.js` | GET /units?search= (складской поиск, 3-tier marking) |
| `backend/src/routes/publicRent.js` | GET /public/warehouse/:token?search= (публичный) |
| `frontend/src/hooks/useGlobalSearch.js` | Ctrl+K модальный поиск |
| `frontend/src/components/shared/GlobalSearchBar.jsx` | UI глобального поиска |
| `frontend/src/components/warehouse/UnitsPage.jsx` | Поиск на складе (3 секции) |
| `frontend/src/components/production/WarehouseViewPage.jsx` | Поиск у продюсера (3 секции) |

### Миграции поиска
| # | Файл | Что делает |
|---|------|-----------|
| 034 | search_tags_and_mega_synonyms | search_tags колонка, 1000 synonym groups, ru_search конфиг |
| 035 | search_umbrella_synonyms | Мета-термины: одежда, мебель, посуда и др. |
| 036 | fix_search_infrastructure | Фикс 032: search_vector на все таблицы, триггеры, бэкфилл |
| 037 | search_lower_tag_weight | AI-теги с веса B → D, ре-бэкфилл |
| 038 | expanded_synonyms | Расширенные синонимы x10 + перекрёстные ссылки |

### Важно при изменениях
- **pg_trgm и unaccent НЕ установлены** на Yandex Managed PostgreSQL (нет прав суперпользователя). `similarity()` не работает, используется ILIKE fallback.
- **Порог 0.5** в `ts_rank_cd` — отсекает совпадения только по AI-тегам. При изменении тегов или весов проверять через `/search/debug?q=...`.
- **Миграция 032 НЕ применена** (rollback из-за CREATE EXTENSION). Вся инфраструктура поиска создана через 034+036.
- Новые SQL-миграции оборачивать в `DO $$ ... EXCEPTION ... END $$` для совместимости с Yandex Managed PostgreSQL.

## Deployment (Yandex Cloud)
```bash
# Полный цикл деплоя:
docker build -t cr.yandex/crp71f1brhdu87cfbr2i/3xproduction:latest .
docker push cr.yandex/crp71f1brhdu87cfbr2i/3xproduction:latest
yc serverless container revision deploy \
  --container-name xproduction \
  --image cr.yandex/crp71f1brhdu87cfbr2i/3xproduction:latest \
  --cores 1 --core-fraction 100 --memory 1GB \
  --concurrency 4 --execution-timeout 300s \
  --service-account-id ajedo095fa8423ft92om \
  --network-id enpib623e5laqanui28p \
  --environment "..." # env vars из текущей ревизии
```
**Важно:** `docker push` НЕ обновляет контейнер автоматически. Нужен `yc serverless container revision deploy` для создания новой ревизии.

## When Stuck
- Остановись и спроси перед: удалением файлов или таблиц БД, изменением схемы миграций, рефакторингом > 3 файлов одновременно.
- Спроси перед изменением логики ролей и разрешений — это критично для безопасности.
- Если тесты (когда появятся) падают после твоих изменений — не пушь, сначала разберись.
- Спроси перед любыми изменениями инфраструктуры в Яндекс Клауд (Container Registry, Managed PostgreSQL, Object Storage) — действия могут затронуть production.
