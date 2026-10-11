# One image runs the web app, the worker and (when DATABASE_URL is unset) an embedded PostgreSQL.
# Works on Render (runs as root, external Postgres) and Hugging Face Spaces (runs as uid 1000, embedded Postgres).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates postgresql && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=7860
COPY --from=build --chown=1000:1000 /app /app
RUN mkdir -p /app/storage && chown 1000:1000 /app/storage
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||7860)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-all.mjs"]
