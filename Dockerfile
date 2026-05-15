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

# Apply pending DB migrations on boot (container is inside the VPC and can
# reach managed-PG), then start the server. Migration runner is guarded by a
# transaction advisory lock so concurrent serverless instances are safe.
CMD ["sh", "-c", "node backend/src/db/migrate.js && node backend/src/index.js"]
