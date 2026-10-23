import { AuditEntry, AuditListInput, theatersWhere } from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditLog, users } from "../../db/schema";
import { authedProcedure, router } from "../init";

export const auditRouter = router({
  list: authedProcedure
    .meta({ openapi: { method: "GET", path: "/audit", tags: ["audit"], protect: true, summary: "Recent changes" } })
    .input(AuditListInput)
    .output(z.array(AuditEntry))
    .query(async ({ ctx, input }) => {
      const { principal } = ctx;
      const allowed = theatersWhere(principal, "audit.read");
      if (input.theaterId && !allowed.includes(input.theaterId)) {
        throw new TRPCError({ code: input.theaterId in principal.theaterRoles ? "FORBIDDEN" : "NOT_FOUND" });
      }
      if (!principal.isSuperAdmin && allowed.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
      }
      // Super admins see everything (including user and theater management);
      // theater admins see events tied to their theaters.
      const where = input.theaterId
        ? eq(auditLog.theaterId, input.theaterId)
        : principal.isSuperAdmin
          ? undefined
          : inArray(auditLog.theaterId, allowed);
      const rows = await ctx.tx
        .select({ a: auditLog, actorName: users.name })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);
      return rows.map(({ a, actorName }) => ({
        id: a.id,
        actorName,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        theaterId: a.theaterId,
        before: a.before,
        after: a.after,
        createdAt: a.createdAt.toISOString(),
      }));
    }),
});
