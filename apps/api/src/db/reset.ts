/** Dev only: drops every table so migrate + seed can rebuild from scratch. */
import postgres from "postgres";
import { env } from "../env";

const url = new URL(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error("db:reset only runs against a local database");
}

const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined });
await sql`drop schema if exists drizzle cascade`;
await sql`drop schema public cascade`;
await sql`create schema public`;
console.log(`reset ${url.pathname.slice(1)}`);
await sql.end();
