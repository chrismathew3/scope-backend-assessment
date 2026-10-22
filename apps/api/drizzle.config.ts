import { defineConfig } from "drizzle-kit";

// Migrations run as the database owner, not the app role.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
