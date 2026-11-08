# Foundation worker image. Build context is the REPO ROOT:
#   docker build -f apps/worker/Dockerfile -t foundation-worker .
# Maritime builds a Dockerfile at the repo root: copy this file there (paths already assume root context).
FROM node:22-slim

# php-cli: the Tester runs php -l and PHP checks. git: Developers branch the MediClaim copy.
# ca-certificates: slim images ship without it and every HTTPS call fails.
RUN apt-get update \
  && apt-get install -y --no-install-recommends php-cli git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app
# Workspace manifests first so the dependency layer caches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/module/package.json apps/module/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@foundation/worker..."

COPY packages/shared packages/shared
COPY apps/worker apps/worker
COPY legacy-demo legacy-demo

# /data survives restarts and sleep/wake on Maritime: keep the agent's MediClaim copy and identity token there.
ENV WORKSPACE_DIR=/data/workspace \
    NODE_ENV=production

WORKDIR /app/apps/worker
# Exec form, no shell string (Maritime re-executes CMD as one flattened string).
CMD ["node", "--import", "tsx", "src/main.ts"]
