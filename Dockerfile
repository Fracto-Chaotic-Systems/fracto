# syntax=docker/dockerfile:1.7
FROM node:22-bookworm AS dependencies

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY servers/fracto-admin-server/package.json servers/fracto-admin-server/package-lock.json servers/fracto-admin-server/
RUN npm ci --prefix servers/fracto-admin-server
COPY servers/fracto-asset-server/package.json servers/fracto-asset-server/package-lock.json servers/fracto-asset-server/
RUN npm ci --prefix servers/fracto-asset-server
COPY servers/fracto-data-server/package.json servers/fracto-data-server/package-lock.json servers/fracto-data-server/
RUN npm ci --prefix servers/fracto-data-server
COPY servers/fracto-tiles-server/package.json servers/fracto-tiles-server/package-lock.json servers/fracto-tiles-server/
RUN npm ci --prefix servers/fracto-tiles-server
COPY servers/fracto-ui/package.json servers/fracto-ui/package-lock.json servers/fracto-ui/.npmrc servers/fracto-ui/
RUN npm ci --prefix servers/fracto-ui

FROM dependencies AS build
ARG VITE_FRACTO_PROD_URL=https://fracto.mikehallstudio.com
ENV VITE_FRACTO_PROD_URL=$VITE_FRACTO_PROD_URL
COPY . .
RUN npm run check
RUN npm --prefix servers/fracto-ui run lint
RUN npm --prefix servers/fracto-ui run build
RUN npm prune --omit=dev \
    && npm prune --omit=dev --prefix servers/fracto-admin-server \
    && npm prune --omit=dev --prefix servers/fracto-asset-server \
    && npm prune --omit=dev --prefix servers/fracto-data-server \
    && npm prune --omit=dev --prefix servers/fracto-tiles-server \
    && npm prune --omit=dev --prefix servers/fracto-ui

FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FRACTO_UI_MODE=static \
    FRACTO_TILE_DATA_DIR=/var/lib/fracto/tiles \
    FRACTO_TILE_INDEX_DIR=/var/lib/fracto/index \
    FRACTO_TILE_INDEX_GENERATIONS_TO_KEEP=2 \
    FRACTO_TILE_MIN_FREE_BYTES=1073741824

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/fracto/tiles /var/lib/fracto/index /app/assets /app/logs \
    && chown -R node:node /var/lib/fracto /app/assets /app/logs \
    && chmod +x /app/docker-entrypoint.sh

USER node
EXPOSE 3001 3002 3003 3004 3005 3006
VOLUME ["/var/lib/fracto/tiles", "/var/lib/fracto/index", "/app/assets", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5m --retries=3 \
  CMD node -e "Promise.all([3001,3002,3003,3004,3005,3006].map(p=>fetch('http://127.0.0.1:'+p+'/').then(r=>{if(!r.ok)throw Error(p)}))).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "--max-old-space-size=16384", "index.js"]
