FROM scratch AS npm-cache

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
ARG NPM_OFFLINE=false
RUN --mount=type=bind,from=npm-cache,target=/npm-cache,rw npm ci --cache /npm-cache --offline=${NPM_OFFLINE} --no-audit --no-fund
COPY server server
COPY client client
RUN test ! -e server/.env && test ! -d .local && npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production PORT=3000 FRONTEND_DIR=/app/client/dist DOCUMENTS_DIR=/data/documents
WORKDIR /app
COPY --chown=node:node --from=build /app/node_modules node_modules
COPY --chown=node:node --from=build /app/server/dist server/dist
COPY --chown=node:node --from=build /app/server/package.json server/package.json
COPY --chown=node:node --from=build /app/client/dist client/dist
RUN mkdir -p /data/documents && chown node:node /data/documents
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/dist/index.js"]
