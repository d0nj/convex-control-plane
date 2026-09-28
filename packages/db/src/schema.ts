import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Application-owned tables for the control database.
 *
 * Auth tables (user, session, account, verification, organization, member,
 * invitation, ssoProvider) are NOT defined here: they are owned by better-auth
 * and generated from the auth config (Task 3) with the better-auth CLI into
 * `src/auth-schema.ts`. Never hand-write or hand-edit that file — see
 * `drizzle.config.ts` for how it joins the schema glob once it exists.
 */

/** Lifecycle of a project, uniform across worker and web. */
export const projectStatus = pgEnum("project_status", [
  "pending",
  "provisioning",
  "healthy",
  "degraded",
  "failed",
  "deleting",
]);

/**
 * One row per project. `slug` is the project's identity: it derives the
 * per-project database name and the two public hostnames. Ids are generated
 * by the caller (web/worker), not by the database.
 */
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  backendImage: text("backend_image").notNull(),
  dashboardEnabled: boolean("dashboard_enabled").notNull().default(false),
  apiUrl: text("api_url"),
  siteUrl: text("site_url"),
  status: projectStatus("status").notNull().default("pending"),
  convexVersion: text("convex_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Encrypted per-project credentials: exactly one row per project, deleted
 * with the project. Ciphertext only — plaintext never reaches the database.
 */
export const projectSecrets = pgTable("project_secrets", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  instanceSecretEnc: text("instance_secret_enc").notNull(),
  adminKeyEnc: text("admin_key_enc").notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

/**
 * Append-only deployment log. Every worker step writes one row here.
 */
export const deploymentEvents = pgTable("deployment_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  job: text("job").notNull(),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
