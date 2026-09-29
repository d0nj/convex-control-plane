# syntax=docker/dockerfile:1
#
# Provisioning worker image (pg-boss + dockerode).
#
# Build context is the MONOREPO ROOT (see infra/compose.yml `worker.build.context`)
# for the same reason as the web image: the worker imports the workspace packages
# `@control/db`, `@control/auth`, and `@control/orchestrator`, which ship raw
# TypeScript.
#
# This is the ONLY container that mounts the Docker socket, so it runs as root:
# the socket is owned by root:docker and the worker must reach it (compose
# passes no `user:`, so the image default applies).
#
# No secret is baked in — all credentials arrive as `${VAR}` from compose.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/orchestrator/package.json packages/orchestrator/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS runner
ENV NODE_ENV=production
COPY apps/worker apps/worker
COPY packages packages
# tsx runs the TypeScript sources directly, so no build step is needed. It is a
# runtime dependency (promoted out of devDependencies) precisely for this.
CMD ["pnpm", "--filter", "@control/worker", "start"]
