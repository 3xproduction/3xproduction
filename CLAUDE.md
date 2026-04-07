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
│   ├── db/               # pg pool, migrate.js, 22 SQL-миграции
│   ├── routes/           # auth, units, warehouses, requests, issuances,
│   │                     # documents, rent, analytics, team, lists, debts
│   └── services/         # r2 (S3), groq (Claude AI), resend (email), push, pdf, docParser
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

## When Stuck
- Остановись и спроси перед: удалением файлов или таблиц БД, изменением схемы миграций, рефакторингом > 3 файлов одновременно.
- Спроси перед изменением логики ролей и разрешений — это критично для безопасности.
- Если тесты (когда появятся) падают после твоих изменений — не пушь, сначала разберись.
- Спроси перед любыми изменениями инфраструктуры в Яндекс Клауд (Container Registry, Managed PostgreSQL, Object Storage) — действия могут затронуть production.
