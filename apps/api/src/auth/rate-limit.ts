/**
 * Login throttling: 5 failed attempts per (IP, email) within 15 minutes, plus a
 * loose 100-per-IP ceiling against password spraying. The per-IP ceiling is high on
 * purpose: a team behind one office IP shouldn't lock each other out with typos.
 * The IP comes from app.ts clientIp(), never from a client-set header.
 * Counts live in Postgres so they hold across serverless instances.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { loginFailures } from "../db/schema";

const WINDOW = sql`now() - interval '15 minutes'`;

/** Seconds until the caller may try again, or null if not blocked. */
export async function loginBlocked(ip: string, email: string): Promise<number | null> {
  const [row] = await db.execute<{ pair: number; per_ip: number; wait: number | null }>(sql`
    select
      count(*) filter (where email = ${email})::int as pair,
      count(*)::int as per_ip,
      ceil(extract(epoch from (
        case when count(*) filter (where email = ${email}) >= 5
          then min(created_at) filter (where email = ${email})
          else min(created_at) end
      ) + interval '15 minutes' - now()))::int as wait
    from login_failure
    where ip = ${ip} and created_at > ${WINDOW}`);
  if (!row || (row.pair < 5 && row.per_ip < 100)) return null;
  return Math.max(1, row.wait ?? 1);
}

export async function recordLoginFailure(ip: string, email: string) {
  await db.insert(loginFailures).values({ ip, email });
}

/** On success: forget this pair's failures and drop anything past the window. */
export async function clearLoginFailures(ip: string, email: string) {
  await db.delete(loginFailures).where(and(eq(loginFailures.ip, ip), eq(loginFailures.email, email)));
  await db.delete(loginFailures).where(lt(loginFailures.createdAt, WINDOW));
}
