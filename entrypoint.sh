#!/bin/sh
set -e

# Fix permissions on the data directory (volume may be mounted as root)
chown -R nodejs:nodejs /app/data

# Drop to non-root user and run the app
exec su -s /bin/sh nodejs -c "pnpm prisma migrate deploy && node dist/index.js"
