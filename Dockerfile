# parez - Production Dockerfile
# Multi-stage build for smaller production image

# =============================================================================
# Stage 1: Build dependencies
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# =============================================================================
# Stage 2: Production runtime
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1000 -S nodejs && \
    adduser -S nodejs -u 1000 -G nodejs

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/server ./server

# Create data directory for SQLite
RUN mkdir -p /app/data /app/logs && chown -R nodejs:nodejs /app/data /app/logs

USER nodejs

EXPOSE 4177

ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/parez.db
ENV COOKIE_SECURE=1
ENV SESSION_TTL_HOURS=24

CMD ["node", "server/src/index.js"]