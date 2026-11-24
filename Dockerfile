# ORBIT cloud "brain" (ORBIT_ROLE=cloud). Build: docker compose -f deploy/cloud/docker-compose.yml build. Guide: docs/CLOUD.md.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# NEXT_PUBLIC_* are baked into the browser bundle at build time, so they come in as build args (public values only).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG ORBIT_BUILD_COMMIT=unknown
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN NODE_OPTIONS=--max-old-space-size=3072 npx next build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 ORBIT_ROLE=cloud ORBIT_DATA_DIR=/data TZ=Europe/Tallinn
# git: build stamp / doctor; tzdata: briefings on Tallinn time; ca-certificates: outbound HTTPS. Claude Code CLI for CORE.
RUN apt-get update && apt-get install -y --no-install-recommends git tzdata ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code --no-audit --no-fund && npm cache clean --force
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# 0.0.0.0 inside the container only: compose publishes no port for it; Caddy reaches it on the private network.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
