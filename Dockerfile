# Compile architecture-independent JavaScript once on the builder's native CPU.
FROM --platform=$BUILDPLATFORM node:26-slim AS build-base

RUN npm install -g pnpm@12.16.1 && npm cache clean --force

WORKDIR /app

FROM build-base AS manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/editor-ext/package.json ./packages/editor-ext/package.json
COPY packages/base-formula/package.json ./packages/base-formula/package.json
COPY patches ./patches

# Version bumps must not invalidate dependency layers. Restore the real manifests
# before compiling and in the runtime image so the embedded version stays correct.
RUN node -e 'const fs = require("node:fs"); for (const file of ["package.json", "apps/client/package.json", "apps/server/package.json"]) { const pkg = JSON.parse(fs.readFileSync(file, "utf8")); delete pkg.version; fs.writeFileSync(file, JSON.stringify(pkg) + "\n"); }'

FROM build-base AS build-deps

COPY --from=manifests /app/ ./
ARG BUILDARCH
RUN --mount=type=cache,id=docmost-pnpm-${BUILDARCH},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM build-deps AS builder

COPY . .
# The frozen install above is authoritative; restored versions must not trigger auto-install.
RUN NX_DAEMON=false PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm build

# Runtime dependencies (including native addons) still use the target CPU.
FROM node:26-slim AS installer

RUN npm install -g pnpm@12.16.1 && npm cache clean --force

WORKDIR /app

COPY --from=manifests /app/ ./
ARG TARGETARCH
# client package.json is only copied for the lockfile check; its deps are bundled in dist
RUN --mount=type=cache,id=docmost-pnpm-${TARGETARCH},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --filter '!./apps/client' --store-dir=/pnpm/store
RUN find /app/node_modules/.pnpm -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.d.ts.map' -o -name '*.d.mts.map' -o -name '*.d.cts.map' \) -delete \
    && mkdir -p /app/data/storage

# pnpm, its store and its caches stay behind in the installer stage
FROM node:26-slim
LABEL org.opencontainers.image.source="https://github.com/docmost/docmost"

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl bash \
  && rm -rf /var/lib/apt/lists/*

# drop npm and corepack
RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -rf /usr/local/lib/node_modules/corepack \
  && rm -rf /usr/local/bin/npm \
  && rm -rf /usr/local/bin/npx \
  && rm -rf /usr/local/bin/corepack \
  && rm -rf /root/.npm \
  && rm -rf /root/.node-gyp

# Keep dependencies in a stable layer; release versions and dist change separately.
COPY --from=installer --chown=node:node /app /app
COPY --chown=node:node package.json /app/package.json
COPY --chown=node:node apps/client/package.json /app/apps/client/package.json
COPY --chown=node:node apps/server/package.json /app/apps/server/package.json
COPY --from=builder --chown=node:node /app/apps/server/dist /app/apps/server/dist
COPY --from=builder --chown=node:node /app/apps/client/dist /app/apps/client/dist
COPY --from=builder --chown=node:node /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --from=builder --chown=node:node /app/packages/base-formula/dist /app/packages/base-formula/dist

WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV NODE_OPTIONS=--no-webstorage

USER node

VOLUME ["/app/data/storage"]

EXPOSE 3000

CMD ["node", "dist/main"]
