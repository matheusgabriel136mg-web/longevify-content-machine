# Dockerfile — Longevify Dashboard Server (cloud production)
# Imagem multi-stage que roda scripts/server.ts 24/7 em qualquer PaaS
# (Render / Railway / Fly / Replit Deploy / Cloud Run).
#
# Build: docker build -t longevify-dashboard .
# Run:   docker run -p 8088:8088 --env-file .env longevify-dashboard

FROM node:22-slim

# ffmpeg pra eventuais story-typing/multi-stage. Sharp tem libs prontas no slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps primeiro (cache layer)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Source — só o que o dashboard server precisa
COPY scripts ./scripts
COPY dashboard ./dashboard
COPY brands ./brands
COPY foundation ./foundation
COPY assets ./assets
COPY BRAND_DEFAULTS.md LONGEVIFY_BRAND.md CLAUDE.md ./
COPY tsconfig.json* ./

# Dados — JSONs leves de snapshots + metadata de runs.
# .gitignore já excluiu binários pesados (assets PNG/MP4 dos runs).
COPY output ./output
COPY runs ./runs

# Garante que pastas existam mesmo sem files (free tier ephemeral fs).
RUN mkdir -p output runs

ENV NODE_ENV=production
ENV PORT=8088
EXPOSE 8088

# Healthcheck — PaaS usam isso pra detectar healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf -u "${DASHBOARD_USER:-longevify}:${DASHBOARD_PASS:-changeme}" \
      http://localhost:8088/api/feed >/dev/null || exit 1

CMD ["npx", "tsx", "scripts/server.ts"]
