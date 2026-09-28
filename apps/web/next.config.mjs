/**
 * Next.js configuration for the control-plane UI.
 *
 * The web app is a thin client of the control database: it renders projects and
 * enqueues pg-boss jobs. It never mounts the Docker socket and never provisions
 * inline (design §1) — provisioning is the worker's job.
 *
 * Two workspace-specific settings are load-bearing:
 *
 * - `transpilePackages`: the workspace packages (`@control/auth`,
 *   `@control/db`) ship raw TypeScript (`main` points at `src/index.ts`), so
 *   Next must compile them from source rather than expect a prebuilt `dist`.
 *
 * - `webpack.resolve.extensionAlias`: those packages are authored in NodeNext
 *   style, so their internal imports are written `./x.js` while the file on
 *   disk is `./x.ts`. TypeScript resolves that substitution, but the bundler
 *   does not by default — without the alias every `./x.js` import fails to
 *   resolve at build time. `--webpack` is pinned in the `dev`/`build` scripts
 *   because Turbopack has no supported equivalent for this alias.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  transpilePackages: ["@control/auth", "@control/db"],
  reactStrictMode: true,
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
