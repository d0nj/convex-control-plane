/**
 * Slug rules and URL/database-name derivations.
 *
 * A project slug is the single identity key for a project: it names the
 * per-project Postgres database, the Traefik routers, and the two public
 * hostnames. Every derived value flows through the helpers below so the
 * rules live in exactly one place.
 */

/**
 * Names that cannot be a project slug because they are already used by
 * control-plane infrastructure or would collide with a route:
 * - `api` / `www` / `dash` — reserved hostname prefixes
 * - `traefik` / `dashboard` / `control` — platform services
 * - `auth` / `mail` — reserved for future use
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "www",
  "dash",
  "traefik",
  "dashboard",
  "control",
  "auth",
  "mail",
]);

/**
 * Leading lowercase letter, then 1-61 of lowercase letters/digits/dashes
 * (total length 2-62). The leading-letter rule keeps the `-` -> `_` database
 * mapping a valid unquoted Postgres identifier.
 */
export const SLUG_RE = /^[a-z][a-z0-9-]{1,61}$/;

/** True when `slug` matches {@link SLUG_RE} and is not a reserved name. */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * Postgres database name for a project: the slug with every dash replaced by
 * an underscore (upstream Convex self-hosted rule). Throws on an invalid slug
 * so a bad name can never reach `CREATE DATABASE`.
 */
export function slugToDbName(slug: string): string {
  if (!isValidSlug(slug)) {
    throw new Error(`invalid project slug: ${JSON.stringify(slug)}`);
  }
  return slug.replace(/-/g, "_");
}

/** Convex API origin for a project: `https://<slug>-api.<domain>`. */
export function buildApiUrl(slug: string, domain: string): string {
  return `https://${slug}-api.${domain}`;
}

/** Convex HTTP-actions/site origin for a project: `https://<slug>.<domain>`. */
export function buildSiteUrl(slug: string, domain: string): string {
  return `https://${slug}.${domain}`;
}
