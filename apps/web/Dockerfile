# syntax=docker/dockerfile:1
#
# Control-plane UI image (Next.js + better-auth).
#
# Build context is the MONOREPO ROOT (see infra/compose.yml `web.build.context`),
# because the app depends on the workspace packages `@control/auth` and
# `@control/db`, which ship raw TypeScript sources. The workspace lockfile is
# required for the frozen install.
#
# No secret is ever baked in: every value below is either a build-phase marker
# or an empty placeholder. Runtime secrets (BETTER_AUTH_SECRET, SECRETS_KEY,
# BETTER_AUTH_URL, DB URL) are injected by compose from `${VAR}` placeholders —
# dev via `infisical run -- docker compose …`, prod via `--env-file .env`.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

# ---- dependency layer (workspace manifests only, so it caches across code edits)
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/orchestrator/package.json packages/orchestrator/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build layer
FROM deps AS build
COPY apps/web apps/web
COPY packages packages
# `next build` runs with NODE_ENV=production, which would trip the fail-fast
# guard in packages/auth (no runtime secret exists at build time). NEXT_PHASE
# tells the guard this is a build, not a serving process.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PHASE=phase-production-build
RUN pnpm --filter @control/web build

# ---- runtime layer
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /repo
# Workspace packages are compiled by the bundler (transpilePackages), so the
# runner needs their sources plus the installed tree. pnpm's node_modules is
# symlink-based, so the manifests come along with the packages.
COPY --from=deps /repo /repo
COPY --from=build /repo/apps/web/.next apps/web/.next
COPY --from=build /repo/apps/web/public apps/web/public
EXPOSE 3000
CMD ["pnpm", "--filter", "@control/web", "start"]
