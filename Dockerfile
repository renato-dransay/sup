# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for Prisma and pnpm
RUN apk add --no-cache openssl && npm install -g pnpm@9.15.0

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

# Build TypeScript
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install openssl for Prisma and pnpm
RUN apk add --no-cache openssl && npm install -g pnpm@9.15.0

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Copy Prisma schema
COPY --from=builder /app/prisma ./prisma

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Provide default env var for Prisma to do validation
ENV DATABASE_URL="file:/app/data/sup.db"

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run as root so entrypoint can fix volume permissions, then drop to nodejs
ENTRYPOINT ["/app/entrypoint.sh"]

