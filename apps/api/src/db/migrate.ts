/**
 * Runs migrations as the database owner. Before migrating it makes sure the
 * app role from DATABASE_URL exists (role provisioning is environment config,
 * so it doesn't live in the migration files).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const ownerUrl = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
const appUrl = new URL(env.DATABASE_URL);
const appRole = decodeURIComponent(appUrl.username);
const appPassword = decodeURIComponent(appUrl.password);

if (appRole !== "scope_app") {
  throw new Error(`DATABASE_URL must connect as scope_app (the migrations grant to it), got "${appRole}"`);
}

const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });

const [exists] = await sql`select 1 as x from pg_roles where rolname = ${appRole}`;
if (!exists) {
  await sql.unsafe(`create role ${appRole} login password '${appPassword.replaceAll("'", "''")}'`);
  console.log(`created role ${appRole}`);
}

await migrate(drizzle(sql), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
console.log("migrations applied");

// The demo reset wipes data, so the app role may only call it on a demo deployment.
// Runs every time, so flipping DEMO_MODE and re-migrating takes effect either way.
if (env.DEMO_MODE) {
  await sql.unsafe(`grant execute on function app_demo_reset(jsonb) to ${appRole}`);
} else {
  await sql.unsafe(`revoke execute on function app_demo_reset(jsonb) from ${appRole}`);
}
console.log(`demo reset ${env.DEMO_MODE ? "enabled" : "disabled"} for ${appRole}`);
await sql.end();
