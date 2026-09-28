import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for the control database.
 *
 * `schema` lists app tables plus the better-auth-generated `auth-schema.ts`
 * (created by the better-auth CLI in Task 3; drizzle-kit tolerates its absence
 * until then, so this file needs no edit once it appears). `db:generate` and
 * `db:migrate` read `DATABASE_URL` from the environment — never commit a value.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
