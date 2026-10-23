import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// The app connects as scope_app, a non-owner role, so row-level security applies.
const client = postgres(env.DATABASE_URL, { max: 10, onnotice: () => undefined });

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Queryable = Db | Tx;

export async function closeDb() {
  await client.end({ timeout: 5 });
}
