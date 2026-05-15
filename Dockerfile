# Multi-stage Dockerfile for GToM.
#
# Build from the workspace root so the shared package imported by GToM is
# available:
#   docker build -f GToM/Dockerfile .
FROM node:20-alpine AS builder

WORKDIR /workspace/GToM

COPY GToM/package*.json ./
COPY GToM/tsconfig.json ./
COPY GToM/scripts/postinstall.js ./scripts/postinstall.js
COPY GToM/migrations ./migrations
RUN npm ci

COPY GToM/src ./src

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /workspace/GToM
ENV NODE_ENV=production
ENV PORT=3003
ENV HEALTH_PORT=8080

COPY GToM/package*.json ./
COPY GToM/scripts/postinstall.js ./scripts/postinstall.js
COPY GToM/migrations ./migrations
RUN npm ci --omit=dev

COPY --from=builder /workspace/GToM/dist ./dist

EXPOSE 3003
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "dist/serve.js"]
