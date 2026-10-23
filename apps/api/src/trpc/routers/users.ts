/**
 * People management.
 *  - Super admins: create any user, set/unset super admin, grant any role anywhere,
 *    deactivate, reset passwords.
 *  - Theater admins: add or remove VIEWERS in theaters they administer.
 * Guardrails: nobody changes their own access; the last super admin stays.
 */
import {
  can,
  membershipChangeDenied,
  IdInput,
  MembershipRemoveInput,
  MembershipSetInput,
  OkOutput,
  theatersWhere,
  UserCreateInput,
  UserCreateOutput,
  UserListInput,
  UserUpdateInput,
  UserView,
} from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { generateTemporaryPassword, hashPassword } from "../../auth/password";
import { assertNotDemoAccount } from "../../auth/demo";
import { revokeUserSessions } from "../../auth/session";
import type { Tx } from "../../db/client";
import { theaterMemberships, theaters, users } from "../../db/schema";
import { audit } from "../../services/audit";
import { type AuthedContext, authedProcedure, isUniqueViolation, requireGlobal, router, superAdminProcedure } from "../init";

const tags = ["users"];

/** Users the caller may see, with memberships limited to theaters the caller manages. */
async function loadUsers(ctx: AuthedContext, opts: { ids?: string[]; theaterId?: string }) {
  const { principal } = ctx;
  const visibleTheaters = principal.isSuperAdmin
    ? Object.keys(principal.theaterRoles)
    : theatersWhere(principal, "member.read");
  if (opts.theaterId && !visibleTheaters.includes(opts.theaterId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
  }
  const theaterFilter = opts.theaterId ? [opts.theaterId] : visibleTheaters;

  // Who is visible: super admins see everyone; admins see members of their theaters.
  let userIds: string[] | undefined = opts.ids;
  if (!principal.isSuperAdmin || opts.theaterId) {
    if (theaterFilter.length === 0) return [];
    const rows = await ctx.tx
      .selectDistinct({ id: theaterMemberships.userId })
      .from(theaterMemberships)
      .where(inArray(theaterMemberships.theaterId, theaterFilter));
    const scoped = rows.map((r) => r.id);
    userIds = userIds ? userIds.filter((id) => scoped.includes(id)) : scoped;
    if (userIds.length === 0) return [];
  }

  const people = await ctx.tx
    .select()
    .from(users)
    .where(userIds ? inArray(users.id, userIds) : undefined)
    .orderBy(asc(users.name));
  if (people.length === 0) return [];
  const memberships = await ctx.tx
    .select({
      userId: theaterMemberships.userId,
      theaterId: theaterMemberships.theaterId,
      theaterName: theaters.name,
      role: theaterMemberships.role,
    })
    .from(theaterMemberships)
    .innerJoin(theaters, eq(theaters.id, theaterMemberships.theaterId))
    .where(
      and(
        inArray(
          theaterMemberships.userId,
          people.map((p) => p.id),
        ),
        principal.isSuperAdmin ? undefined : inArray(theaterMemberships.theaterId, visibleTheaters),
      ),
    )
    .orderBy(asc(theaters.name));

  return people.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isSuperAdmin: u.isSuperAdmin,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    memberships: memberships
      .filter((m) => m.userId === u.id)
      .map(({ theaterId, theaterName, role }) => ({ theaterId, theaterName, role })),
  }));
}

async function getUserOr404(ctx: AuthedContext, id: string) {
  const [u] = await loadUsers(ctx, { ids: [id] });
  if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  return u;
}

/**
 * Locks the active super admin rows, then counts them. Two requests removing
 * different super admins at once serialize here, so the last one can't be removed.
 */
async function lockActiveSuperAdmins(tx: Tx) {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isSuperAdmin, true), eq(users.status, "active")))
    .for("update");
  return rows.length;
}

function assertNotSelf(ctx: AuthedContext, userId: string, what: string) {
  if (userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: `You can't ${what} yourself` });
}

/** Can the caller grant/remove this role in this theater? */
function assertCanManageMembership(ctx: AuthedContext, theaterId: string, role: "admin" | "viewer") {
  // theaterRoles holds live (non-archived) theaters only, for super admins too.
  if (!(theaterId in ctx.principal.theaterRoles)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
  }
  const denied = membershipChangeDenied(ctx.principal, theaterId, role);
  if (denied) throw new TRPCError({ code: "FORBIDDEN", message: denied });
}

export const usersRouter = router({
  list: authedProcedure
    .meta({ openapi: { method: "GET", path: "/users", tags, protect: true } })
    .input(UserListInput)
    .output(z.array(UserView))
    .query(({ ctx, input }) => loadUsers(ctx, { theaterId: input.theaterId })),

  get: authedProcedure
    .meta({ openapi: { method: "GET", path: "/users/{id}", tags, protect: true } })
    .input(IdInput)
    .output(UserView)
    .query(({ ctx, input }) => getUserOr404(ctx, input.id)),

  create: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/users",
        tags,
        protect: true,
        summary: "Create a user with a one-time temporary password",
      },
    })
    .input(UserCreateInput)
    .output(UserCreateOutput)
    .mutation(async ({ ctx, input }) => {
      if (input.isSuperAdmin) requireGlobal(ctx, "user.manage");
      if (!ctx.principal.isSuperAdmin && input.memberships.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add the new user to at least one of your theaters" });
      }
      const seen = new Set<string>();
      for (const m of input.memberships) {
        if (seen.has(m.theaterId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Theater listed twice" });
        seen.add(m.theaterId);
        assertCanManageMembership(ctx, m.theaterId, m.role);
      }
      const temporaryPassword = generateTemporaryPassword();
      let created;
      try {
        [created] = await ctx.tx
          .insert(users)
          .values({
            name: input.name,
            email: input.email,
            isSuperAdmin: input.isSuperAdmin,
            passwordHash: await hashPassword(temporaryPassword),
            mustChangePassword: true,
            createdBy: ctx.user.id,
          })
          .returning();
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: "A user with that email already exists" });
        throw e;
      }
      if (input.memberships.length) {
        await ctx.tx.insert(theaterMemberships).values(
          input.memberships.map((m) => ({ userId: created!.id, theaterId: m.theaterId, role: m.role, grantedBy: ctx.user.id })),
        );
      }
      await audit(ctx, {
        action: "user.create",
        entityType: "user",
        entityId: created!.id,
        after: { email: input.email, isSuperAdmin: input.isSuperAdmin, memberships: input.memberships },
      });
      return { user: await getUserOr404(ctx, created!.id), temporaryPassword };
    }),

  update: superAdminProcedure
    .meta({ openapi: { method: "PATCH", path: "/users/{id}", tags, protect: true } })
    .input(UserUpdateInput)
    .output(UserView)
    .mutation(async ({ ctx, input }) => {
      const before = await getUserOr404(ctx, input.id);
      if (input.isSuperAdmin !== undefined && input.isSuperAdmin !== before.isSuperAdmin) {
        assertNotSelf(ctx, input.id, "change super admin on");
        assertNotDemoAccount(input.id, "promoted or demoted");
        if (!input.isSuperAdmin && (await lockActiveSuperAdmins(ctx.tx)) <= 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "There must be at least one super admin" });
        }
      }
      await ctx.tx
        .update(users)
        .set({ name: input.name, isSuperAdmin: input.isSuperAdmin })
        .where(eq(users.id, input.id));
      if (input.isSuperAdmin !== undefined && input.isSuperAdmin !== before.isSuperAdmin) {
        await revokeUserSessions(ctx.tx, input.id);
      }
      await audit(ctx, {
        action: "user.update",
        entityType: "user",
        entityId: input.id,
        before: { name: before.name, isSuperAdmin: before.isSuperAdmin },
        after: { name: input.name, isSuperAdmin: input.isSuperAdmin },
      });
      return getUserOr404(ctx, input.id);
    }),

  deactivate: superAdminProcedure
    .meta({ openapi: { method: "POST", path: "/users/{id}/deactivate", tags, protect: true } })
    .input(IdInput)
    .output(UserView)
    .mutation(async ({ ctx, input }) => {
      assertNotSelf(ctx, input.id, "deactivate");
      assertNotDemoAccount(input.id, "deactivated");
      const before = await getUserOr404(ctx, input.id);
      if (before.isSuperAdmin && before.status === "active" && (await lockActiveSuperAdmins(ctx.tx)) <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "There must be at least one super admin" });
      }
      await ctx.tx.update(users).set({ status: "deactivated" }).where(eq(users.id, input.id));
      await revokeUserSessions(ctx.tx, input.id);
      await audit(ctx, { action: "user.deactivate", entityType: "user", entityId: input.id });
      return getUserOr404(ctx, input.id);
    }),

  reactivate: superAdminProcedure
    .meta({ openapi: { method: "POST", path: "/users/{id}/reactivate", tags, protect: true } })
    .input(IdInput)
    .output(UserView)
    .mutation(async ({ ctx, input }) => {
      await getUserOr404(ctx, input.id);
      await ctx.tx.update(users).set({ status: "active" }).where(eq(users.id, input.id));
      await audit(ctx, { action: "user.reactivate", entityType: "user", entityId: input.id });
      return getUserOr404(ctx, input.id);
    }),

  resetPassword: superAdminProcedure
    .meta({ openapi: { method: "POST", path: "/users/{id}/reset-password", tags, protect: true } })
    .input(IdInput)
    .output(z.object({ temporaryPassword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertNotSelf(ctx, input.id, "reset the password of");
      assertNotDemoAccount(input.id, "given a new password");
      await getUserOr404(ctx, input.id);
      const temporaryPassword = generateTemporaryPassword();
      await ctx.tx
        .update(users)
        .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true })
        .where(eq(users.id, input.id));
      await revokeUserSessions(ctx.tx, input.id);
      await audit(ctx, { action: "user.password_reset", entityType: "user", entityId: input.id });
      return { temporaryPassword };
    }),
});

export const membershipsRouter = router({
  /** Add a user to a theater, or change their role there. */
  set: authedProcedure
    .meta({ openapi: { method: "PUT", path: "/theaters/{theaterId}/members/{userId}", tags: ["memberships"], protect: true } })
    .input(MembershipSetInput)
    .output(OkOutput)
    .mutation(async ({ ctx, input }) => {
      assertNotSelf(ctx, input.userId, "change theater access for");
      assertCanManageMembership(ctx, input.theaterId, input.role);
      const [target] = await ctx.tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const [existing] = await ctx.tx
        .select({ role: theaterMemberships.role })
        .from(theaterMemberships)
        .where(and(eq(theaterMemberships.userId, input.userId), eq(theaterMemberships.theaterId, input.theaterId)));
      // A theater admin can't demote another admin; only a super admin can.
      if (existing?.role === "admin") assertCanManageMembership(ctx, input.theaterId, "admin");
      await ctx.tx
        .insert(theaterMemberships)
        .values({ ...input, grantedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [theaterMemberships.userId, theaterMemberships.theaterId],
          set: { role: input.role, grantedBy: ctx.user.id, updatedAt: sql`now()` },
        });
      await audit(ctx, {
        action: "membership.set",
        entityType: "user",
        entityId: input.userId,
        theaterId: input.theaterId,
        before: existing ?? null,
        after: { role: input.role },
      });
      return { ok: true as const };
    }),

  remove: authedProcedure
    .meta({ openapi: { method: "DELETE", path: "/theaters/{theaterId}/members/{userId}", tags: ["memberships"], protect: true } })
    .input(MembershipRemoveInput)
    .output(OkOutput)
    .mutation(async ({ ctx, input }) => {
      assertNotSelf(ctx, input.userId, "change theater access for");
      const [existing] = await ctx.tx
        .select({ role: theaterMemberships.role })
        .from(theaterMemberships)
        .where(and(eq(theaterMemberships.userId, input.userId), eq(theaterMemberships.theaterId, input.theaterId)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Membership not found" });
      assertCanManageMembership(ctx, input.theaterId, existing.role);
      await ctx.tx
        .delete(theaterMemberships)
        .where(and(eq(theaterMemberships.userId, input.userId), eq(theaterMemberships.theaterId, input.theaterId)));
      await audit(ctx, {
        action: "membership.remove",
        entityType: "user",
        entityId: input.userId,
        theaterId: input.theaterId,
        before: existing,
      });
      return { ok: true as const };
    }),
});
