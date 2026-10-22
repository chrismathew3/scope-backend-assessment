import { randomUUID } from "node:crypto";
import { can, type GlobalPermission, type Principal, type TheaterPermission, type TheaterRole } from "@scope/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z } from "zod";
import { readCookie, resolveSession, SESSION_COOKIE, type SessionUser } from "../auth/session";
import { db, type Tx } from "../db/client";
import { theaterMemberships, theaters, users } from "../db/schema";

export interface ContextOptions {
  req: Request;
  /** Only append is used (Set-Cookie). Both adapters can provide it. */
  resHeaders: Pick<Headers, "append">;
  ip: string | null;
}

export async function createContext({ req, resHeaders, ip }: ContextOptions) {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const session = token ? await resolveSession(token) : null;
  return {
    req,
    resHeaders,
    ip,
    requestId: req.headers.get("x-request-id") ?? randomUUID(),
    userAgent: req.headers.get("user-agent"),
    sessionId: session?.sessionId ?? null,
    user: session?.user ?? null,
  };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
  .create({
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          stack: undefined,
          zodError: error.cause instanceof z.ZodError ? z.flattenError(error.cause) : null,
        },
      };
    },
  });

export const router = t.router;
export const publicProcedure = t.procedure;

/** Builds the caller's effective roles. Reloaded from the database on every request. */
async function loadPrincipal(user: SessionUser): Promise<Principal & { theaterNames: Record<string, string> }> {
  const theaterRoles: Record<string, TheaterRole> = {};
  const theaterNames: Record<string, string> = {};
  if (user.isSuperAdmin) {
    const all = await db.select({ id: theaters.id, name: theaters.name }).from(theaters).where(isNull(theaters.archivedAt));
    for (const th of all) {
      theaterRoles[th.id] = "admin";
      theaterNames[th.id] = th.name;
    }
  } else {
    const rows = await db
      .select({ id: theaters.id, name: theaters.name, role: theaterMemberships.role })
      .from(theaterMemberships)
      .innerJoin(theaters, eq(theaters.id, theaterMemberships.theaterId))
      .innerJoin(users, eq(users.id, theaterMemberships.userId))
      .where(and(eq(theaterMemberships.userId, user.id), isNull(theaters.archivedAt), eq(users.status, "active")));
    for (const r of rows) {
      theaterRoles[r.id] = r.role;
      theaterNames[r.id] = r.name;
    }
  }
  return { userId: user.id, isSuperAdmin: user.isSuperAdmin, theaterRoles, theaterNames };
}

class Rollback extends Error {}

/**
 * Signed-in procedures. Each call runs in one transaction that tells Postgres
 * who the user is, so row-level security applies to every query, and any
 * error rolls back everything the call wrote (including audit rows).
 */
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(["me.get", "auth.changePassword", "auth.logout"]);

export const authedProcedure = t.procedure.use(async ({ ctx, next, path }) => {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  // Accounts created with a temporary password must set their own first.
  if (user.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Set a new password first" });
  }
  const principal = await loadPrincipal(user);

  const run = (tx: Tx) => next({ ctx: { ...ctx, user, principal, tx } });
  let result: Awaited<ReturnType<typeof run>> | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
      result = await run(tx);
      if (!result.ok) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result!;
});

export const superAdminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.principal.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Super admin only" });
  return next();
});

export type AuthedContext = Context & {
  user: SessionUser;
  principal: Principal & { theaterNames: Record<string, string> };
  tx: Tx;
};

/**
 * Theater-level check. Not a member -> 404 (don't reveal the theater exists);
 * member without the permission -> 403.
 */
export function requireTheater(ctx: AuthedContext, theaterId: string, permission: TheaterPermission) {
  if (!(theaterId in ctx.principal.theaterRoles)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
  }
  if (!can(ctx.principal, permission, theaterId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Your role in this theater can't do that (${permission})` });
  }
}

export function requireGlobal(ctx: AuthedContext, permission: GlobalPermission) {
  if (!can(ctx.principal, permission)) throw new TRPCError({ code: "FORBIDDEN", message: "Super admin only" });
}

/** Maps Postgres unique violations to a 409. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
