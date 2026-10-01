# Multi-stage build for Parez
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PAREZ_DATA_DIR=/app/data

# Copy built assets and server code
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/scripts ./scripts

# Install production deps only
RUN npm ci --omit=dev

# Data directory for SQLite (mounted as volume)
VOLUME ["/app/data"]

EXPOSE 4177

CMD ["node", "server/src/index.js"]