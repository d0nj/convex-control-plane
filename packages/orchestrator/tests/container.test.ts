import { describe, expect, it } from "vitest";

import { buildBackendContainerSpec } from "../src/container.js";

// Fixed inputs so the expected values below are literal and readable. The
// instance secret is a throwaway literal: these tests only assert that it is
// forwarded into Env, never that it is stored anywhere.
const INPUT = {
  slug: "demo",
  domain: "example.com",
  backendImage: "ghcr.io/get-convex/convex-backend:latest",
  postgresBaseUrl: "postgres://convex:pw@convex-data-postgres:5432",
  instanceSecret: "instance-secret-value",
};

const spec = buildBackendContainerSpec(INPUT);

describe("buildBackendContainerSpec", () => {
  it("names the container convex-<slug>", () => {
    expect(spec.name).toBe("convex-demo");
  });

  it("joins the proxy network without publishing host ports", () => {
    expect({
      portBindings: spec.HostConfig.PortBindings,
      networkMode: spec.HostConfig.NetworkMode,
    }).toEqual({ portBindings: undefined, networkMode: "proxy" });
  });

  it("routes the api and site hosts over websecure with the letsencrypt resolver", () => {
    expect({
      apiRule: spec.Labels["traefik.http.routers.convex-demo-api.rule"],
      apiEntrypoint:
        spec.Labels["traefik.http.routers.convex-demo-api.entrypoints"],
      apiResolver:
        spec.Labels["traefik.http.routers.convex-demo-api.tls.certresolver"],
      apiPort:
        spec.Labels[
          "traefik.http.services.convex-demo-api.loadbalancer.server.port"
        ],
      siteRule: spec.Labels["traefik.http.routers.convex-demo-site.rule"],
      siteEntrypoint:
        spec.Labels["traefik.http.routers.convex-demo-site.entrypoints"],
      siteResolver:
        spec.Labels["traefik.http.routers.convex-demo-site.tls.certresolver"],
      sitePort:
        spec.Labels[
          "traefik.http.services.convex-demo-site.loadbalancer.server.port"
        ],
    }).toEqual({
      apiRule: "Host(`demo-api.example.com`)",
      apiEntrypoint: "websecure",
      apiResolver: "letsencrypt",
      apiPort: "3210",
      siteRule: "Host(`demo.example.com`)",
      siteEntrypoint: "websecure",
      siteResolver: "letsencrypt",
      sitePort: "3211",
    });
  });

  it("forwards the instance, origin, and postgres environment", () => {
    const env = Object.fromEntries(
      spec.Env.map((entry) => entry.split("=", 2) as [string, string]),
    );
    expect({
      INSTANCE_NAME: env.INSTANCE_NAME,
      CONVEX_CLOUD_ORIGIN: env.CONVEX_CLOUD_ORIGIN,
      CONVEX_SITE_ORIGIN: env.CONVEX_SITE_ORIGIN,
      POSTGRES_URL: env.POSTGRES_URL,
    }).toEqual({
      INSTANCE_NAME: "demo",
      CONVEX_CLOUD_ORIGIN: "https://demo-api.example.com",
      CONVEX_SITE_ORIGIN: "https://demo.example.com",
      POSTGRES_URL: "postgres://convex:pw@convex-data-postgres:5432",
    });
  });

  it("binds the api router to the api service", () => {
    expect(spec.Labels["traefik.http.routers.convex-demo-api.service"]).toBe(
      "convex-demo-api",
    );
  });

  it("binds the site router to the site service", () => {
    expect(spec.Labels["traefik.http.routers.convex-demo-site.service"]).toBe(
      "convex-demo-site",
    );
  });
});
