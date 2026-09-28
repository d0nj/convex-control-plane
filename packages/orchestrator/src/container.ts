/**
 * Pure builders for the per-project Docker container specs.
 *
 * Everything here is a plain data transformation: no `dockerode` import, no
 * Docker socket, no filesystem, no secret storage. The worker (Task 5) is the
 * only caller that talks to Docker, and it passes the returned objects straight
 * to `docker.createContainer(...)`. Keeping the spec pure means the exact
 * container shape — labels, env, resource limits, healthcheck — is unit-tested
 * without a daemon.
 *
 * `instanceSecret` is plaintext *only* at call time. The caller encrypts it at
 * rest (Task 3) before persisting; this module never stores or logs it.
 */

/** Inputs needed to describe one project's Convex backend container. */
export interface BackendSpecInput {
  /** Project slug: identity for container name, hosts, and INSTANCE_NAME. */
  slug: string;
  /** Public base domain, e.g. `example.com` (no scheme). */
  domain: string;
  /** Pinned backend image ref, e.g. `ghcr.io/get-convex/convex-backend:latest`. */
  backendImage: string;
  /**
   * Postgres connection string WITHOUT the database name (upstream rule: the
   * backend derives the db name from INSTANCE_NAME, `-` -> `_`). See
   * `self-hosted/advanced/postgres_or_mysql.md`.
   */
  postgresBaseUrl: string;
  /** Plaintext instance secret for this call only; encrypted at rest upstream. */
  instanceSecret: string;
}

/** Healthcheck in Docker API form (durations are nanoseconds, as the API wants). */
export interface ContainerHealthcheck {
  Test: string[];
  Interval: number;
  StartPeriod: number;
}

/** The subset of `HostConfig` this module sets. */
export interface ContainerHostConfig {
  NetworkMode: string;
  RestartPolicy: { Name: string };
  /** Bytes. */
  Memory: number;
  /** Named-volume binds, `source:target`. */
  Binds: string[];
  /**
   * Deliberately never set: containers are reached through Traefik on the
   * shared `proxy` network, so no host port is published. Typed as `undefined`
   * so the invariant is visible at compile time and asserted in tests.
   */
  PortBindings?: undefined;
}

/** Exactly the `docker.createContainer` option shape for a backend container. */
export interface BackendContainerSpec {
  name: string;
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: ContainerHostConfig;
  Healthcheck: ContainerHealthcheck;
}

/** Exactly the `docker.createContainer` option shape for a dashboard container. */
export interface DashboardContainerSpec {
  name: string;
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: {
    NetworkMode: string;
    RestartPolicy: { Name: string };
  };
}

/** 2 GiB in bytes. */
const TWO_GIB = 2 * 1024 * 1024 * 1024;

/** 5s / 10s in nanoseconds (Docker's unit for healthcheck durations). */
const FIVE_SECONDS_NS = 5_000_000_000;
const TEN_SECONDS_NS = 10_000_000_000;

/** Shared Traefik entrypoint/resolver used by every per-project router. */
const ENTRYPOINT = "websecure";
const CERT_RESOLVER = "letsencrypt";

/**
 * Build the `docker.createContainer` options for a project's Convex backend.
 *
 * The container joins the shared `proxy` network and is routed by Traefik via
 * labels — no host port is ever published (upstream ports 3210 api / 3211 site
 * stay container-internal). Origins are the public https hosts so they can be
 * embedded in storage URLs and action callbacks.
 */
export function buildBackendContainerSpec(
  input: BackendSpecInput,
): BackendContainerSpec {
  const { slug, domain, backendImage, postgresBaseUrl, instanceSecret } = input;

  const name = `convex-${slug}`;
  const apiHost = `${slug}-api.${domain}`;
  const siteHost = `${slug}.${domain}`;
  const apiUrl = `https://${apiHost}`;
  const siteUrl = `https://${siteHost}`;

  // Env keys mirror `self-hosted/docker-build/run_backend.sh:58-64`. The DB
  // name is derived by the backend from INSTANCE_NAME, so POSTGRES_URL is
  // passed through verbatim with no database appended.
  const Env = [
    `POSTGRES_URL=${postgresBaseUrl}`,
    `INSTANCE_NAME=${slug}`,
    `INSTANCE_SECRET=${instanceSecret}`,
    `CONVEX_CLOUD_ORIGIN=${apiUrl}`,
    `CONVEX_SITE_ORIGIN=${siteUrl}`,
    "RUST_LOG=info",
  ];

  // Two routers on one container: api host -> 3210, site host -> 3211.
  const Labels: Record<string, string> = {
    "traefik.enable": "true",

    [`traefik.http.routers.${name}-api.rule`]: `Host(\`${apiHost}\`)`,
    [`traefik.http.routers.${name}-api.entrypoints`]: ENTRYPOINT,
    [`traefik.http.routers.${name}-api.tls`]: "true",
    [`traefik.http.routers.${name}-api.tls.certresolver`]: CERT_RESOLVER,
    [`traefik.http.services.${name}-api.loadbalancer.server.port`]: "3210",

    [`traefik.http.routers.${name}-site.rule`]: `Host(\`${siteHost}\`)`,
    [`traefik.http.routers.${name}-site.entrypoints`]: ENTRYPOINT,
    [`traefik.http.routers.${name}-site.tls`]: "true",
    [`traefik.http.routers.${name}-site.tls.certresolver`]: CERT_RESOLVER,
    [`traefik.http.services.${name}-site.loadbalancer.server.port`]: "3211",
  };

  const HostConfig: ContainerHostConfig = {
    NetworkMode: "proxy",
    RestartPolicy: { Name: "unless-stopped" },
    Memory: TWO_GIB,
    // Named volume for local file/search storage (S3 deferred); persists across
    // recreates on image update (design §3, project.update).
    Binds: [`${slug}-data:/convex/data`],
  };

  // Upstream healthcheck: `curl -f http://localhost:3210/version`
  // (`self-hosted/docker/docker-compose.yml:49-52`).
  const Healthcheck: ContainerHealthcheck = {
    Test: ["CMD-SHELL", "curl -f http://localhost:3210/version"],
    Interval: FIVE_SECONDS_NS,
    StartPeriod: TEN_SECONDS_NS,
  };

  return { name, Image: backendImage, Env, Labels, HostConfig, Healthcheck };
}

/**
 * Build the `docker.createContainer` options for an optional project dashboard.
 *
 * The dashboard is a separate container reached at `dash-<slug>.<domain>` on
 * port 6791 (upstream `hosting_on_own_infra.md`); it points its browser bundle
 * at the project's public API origin via NEXT_PUBLIC_DEPLOYMENT_URL.
 */
export function dashboardSpec(
  slug: string,
  domain: string,
  apiUrl: string,
): DashboardContainerSpec {
  const name = `convex-dash-${slug}`;
  const dashHost = `dash-${slug}.${domain}`;

  const Env = [`NEXT_PUBLIC_DEPLOYMENT_URL=${apiUrl}`];

  const Labels: Record<string, string> = {
    "traefik.enable": "true",
    [`traefik.http.routers.${name}.rule`]: `Host(\`${dashHost}\`)`,
    [`traefik.http.routers.${name}.entrypoints`]: ENTRYPOINT,
    [`traefik.http.routers.${name}.tls`]: "true",
    [`traefik.http.routers.${name}.tls.certresolver`]: CERT_RESOLVER,
    [`traefik.http.services.${name}.loadbalancer.server.port`]: "6791",
  };

  return {
    name,
    Image: "ghcr.io/get-convex/convex-dashboard:latest",
    Env,
    Labels,
    HostConfig: {
      NetworkMode: "proxy",
      RestartPolicy: { Name: "unless-stopped" },
    },
  };
}
