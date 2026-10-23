import {
  ChangePasswordInput,
  DevAccount,
  LoginInput,
  Me,
  OkOutput,
  SUPER_ADMIN_PERMISSIONS,
  THEATER_PERMISSIONS,
} from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../auth/password";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "../../auth/rate-limit";
import {
  clearedSessionCookie,
  createSession,
  deleteSession,
  revokeUserSessions,
  sessionCookie,
} from "../../auth/session";
import { db } from "../../db/client";
import { fixtures } from "../../db/fixtures";
import { users } from "../../db/schema";
import { showDemoAccounts } from "../../env";
import { assertNotDemoAccount } from "../../auth/demo";
import { audit } from "../../services/audit";
import { authedProcedure, publicProcedure, router } from "../init";

const tags = ["auth"];

export const authRouter = router({
  login: publicProcedure
    .meta({ openapi: { method: "POST", path: "/auth/login", tags, summary: "Sign in; sets the session cookie" } })
    .input(LoginInput)
    .output(OkOutput)
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const wait = loginBlocked(ctx.ip, email);
      if (wait) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many attempts. Try again in ${wait}s.` });
      }
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
        .from(users)
        .where(eq(sql`lower(${users.email})`, email))
        .limit(1);
      // Always run the hash so response time doesn't reveal whether the email exists.
      const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok || user.status !== "active") {
        recordLoginFailure(ctx.ip, email);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect" });
      }
      clearLoginFailures(ctx.ip, email);
      const token = await createSession(user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
      ctx.resHeaders.append("Set-Cookie", sessionCookie(token));
      return { ok: true as const };
    }),

  logout: publicProcedure
    .meta({ openapi: { method: "POST", path: "/auth/logout", tags } })
    .input(z.object({}).optional())
    .output(OkOutput)
    .mutation(async ({ ctx }) => {
      if (ctx.sessionId) await deleteSession(ctx.sessionId);
      ctx.resHeaders.append("Set-Cookie", clearedSessionCookie());
      return { ok: true as const };
    }),

  changePassword: authedProcedure
    .meta({ openapi: { method: "POST", path: "/auth/password", tags, protect: true } })
    .input(ChangePasswordInput)
    .output(OkOutput)
    .mutation(async ({ ctx, input }) => {
      assertNotDemoAccount(ctx.user.id, "given a new password");
      const [row] = await ctx.tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id));
      if (!row || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect" });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a different password" });
      }
      await ctx.tx
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
        .where(eq(users.id, ctx.user.id));
      // Other devices are signed out; this one stays.
      await revokeUserSessions(ctx.user.id, ctx.sessionId ?? undefined);
      await audit(ctx, { action: "user.password_change", entityType: "user", entityId: ctx.user.id });
      return { ok: true as const };
    }),

  /** Seeded accounts for the quick sign-in list. Local dev and the public demo only. */
  devAccounts: publicProcedure
    .meta({ openapi: { method: "GET", path: "/auth/dev-accounts", tags } })
    .input(z.object({}).optional())
    .output(z.array(DevAccount))
    .query(() => {
      if (!showDemoAccounts) return [];
      const names = Object.fromEntries(fixtures.theaters.map((t) => [t.id, t.name.split(" ")[0]]));
      return fixtures.users.map((u) => ({
        email: u.email,
        name: u.name,
        summary: u.isSuperAdmin
          ? "Super admin · all theaters"
          : u.memberships.length === 0
            ? "No theaters"
            : u.memberships.map((m) => `${m.role} · ${names[m.theaterId]}`).join(", "),
      }));
    }),
});

export const meRouter = router({
  get: authedProcedure
    .meta({ openapi: { method: "GET", path: "/me", tags: ["me"], protect: true } })
    .input(z.object({}).optional())
    .output(Me.extend({ mustChangePassword: z.boolean() }))
    .query(({ ctx }) => {
      const { principal, user } = ctx;
      const perms = new Set<string>();
      for (const [theaterId, role] of Object.entries(principal.theaterRoles)) {
        for (const p of THEATER_PERMISSIONS[role]) perms.add(`${p}@${theaterId}`);
      }
      if (principal.isSuperAdmin) for (const p of SUPER_ADMIN_PERMISSIONS) perms.add(p);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        isSuperAdmin: principal.isSuperAdmin,
        mustChangePassword: user.mustChangePassword,
        theaterRoles: principal.theaterRoles,
        permissions: [...perms].sort(),
      };
    }),
});
