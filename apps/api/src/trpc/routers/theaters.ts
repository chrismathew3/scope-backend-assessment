import { IdInput, Theater, TheaterCreateInput, TheaterUpdateInput } from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { theaters } from "../../db/schema";
import { audit } from "../../services/audit";
import { authedProcedure, isUniqueViolation, requireGlobal, router, superAdminProcedure } from "../init";

const tags = ["theaters"];

export const theatersRouter = router({
  list: authedProcedure
    .meta({ openapi: { method: "GET", path: "/theaters", tags, protect: true, summary: "Theaters you belong to" } })
    .input(z.object({}).optional())
    .output(z.array(Theater))
    .query(async ({ ctx }) => {
      const ids = Object.keys(ctx.principal.theaterRoles);
      if (ids.length === 0) return [];
      const rows = await ctx.tx.select().from(theaters).where(inArray(theaters.id, ids)).orderBy(theaters.name);
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        location: t.location,
        timezone: t.timezone,
        myRole: ctx.principal.theaterRoles[t.id]!,
      }));
    }),

  get: authedProcedure
    .meta({ openapi: { method: "GET", path: "/theaters/{id}", tags, protect: true } })
    .input(IdInput)
    .output(Theater)
    .query(async ({ ctx, input }) => {
      const role = ctx.principal.theaterRoles[input.id];
      const [t] = role ? await ctx.tx.select().from(theaters).where(eq(theaters.id, input.id)) : [];
      if (!t || !role) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
      return { id: t.id, name: t.name, location: t.location, timezone: t.timezone, myRole: role };
    }),

  create: superAdminProcedure
    .meta({ openapi: { method: "POST", path: "/theaters", tags, protect: true } })
    .input(TheaterCreateInput)
    .output(Theater)
    .mutation(async ({ ctx, input }) => {
      requireGlobal(ctx, "theater.manage");
      try {
        const [t] = await ctx.tx.insert(theaters).values(input).returning();
        await audit(ctx, { action: "theater.create", entityType: "theater", entityId: t!.id, theaterId: t!.id, after: input });
        return { id: t!.id, name: t!.name, location: t!.location, timezone: t!.timezone, myRole: "admin" as const };
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: "A theater with that name exists" });
        throw e;
      }
    }),

  update: superAdminProcedure
    .meta({ openapi: { method: "PATCH", path: "/theaters/{id}", tags, protect: true } })
    .input(TheaterUpdateInput)
    .output(Theater)
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const [before] = await ctx.tx.select().from(theaters).where(eq(theaters.id, id));
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
      try {
        const [t] = await ctx.tx.update(theaters).set(patch).where(eq(theaters.id, id)).returning();
        await audit(ctx, { action: "theater.update", entityType: "theater", entityId: id, theaterId: id, before, after: patch });
        return { id: t!.id, name: t!.name, location: t!.location, timezone: t!.timezone, myRole: "admin" as const };
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: "A theater with that name exists" });
        throw e;
      }
    }),

  archive: superAdminProcedure
    .meta({ openapi: { method: "DELETE", path: "/theaters/{id}", tags, protect: true, summary: "Archive (soft delete)" } })
    .input(IdInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [t] = await ctx.tx
        .update(theaters)
        .set({ archivedAt: new Date() })
        .where(eq(theaters.id, input.id))
        .returning({ id: theaters.id });
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
      await audit(ctx, { action: "theater.archive", entityType: "theater", entityId: input.id, theaterId: input.id });
      return { ok: true as const };
    }),
});
