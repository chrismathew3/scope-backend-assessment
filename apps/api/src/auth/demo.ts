import { TRPCError } from "@trpc/server";
import { fixtures } from "../db/fixtures";
import { env } from "../env";

const seededIds = new Set(fixtures.users.map((u) => u.id));

/**
 * In the public demo anyone can sign in as any seeded account, so those
 * accounts can't be deactivated, re-passworded or demoted. Otherwise one
 * visitor could lock everyone else out.
 */
export function assertNotDemoAccount(userId: string, what: string) {
  if (env.DEMO_MODE && seededIds.has(userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Demo accounts can't be ${what}. Create a new user to try this.` });
  }
}
