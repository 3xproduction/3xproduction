FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json ./frontend/

# Install dependencies
RUN cd backend && npm install
RUN cd frontend && npm install --include=dev

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build frontend (BUILD_MODE=staging → использует .env.staging и включает DEV-брендинг)
ARG BUILD_MODE=production
RUN cd frontend && npx vite build --mode ${BUILD_MODE}

EXPOSE 3000

# NOTE: migrations are NOT auto-run on boot. Prod _migrations is out of sync
# with the migrations/ dir (prod schema predates migration tracking), so a
# boot-time `migrate` replays non-idempotent old migrations and crashes the
# container (caused a prod 502). Apply migrations out-of-band via the proper
# DB path. See backend/src/db/migrate.js.
CMD ["node", "backend/src/index.js"]
