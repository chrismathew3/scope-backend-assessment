import {
  ArchiveAllInput,
  ArchiveAllOutput,
  IdInput,
  ShowtimeAdminRow,
  ShowtimeFacets,
  ShowtimeFacetsInput,
  ShowtimeListInput,
  ShowtimeListOutput,
  ShowtimeRow,
  ShowtimeUpdateInput,
} from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { showtimes, theaters } from "../../db/schema";
import { audit } from "../../services/audit";
import { listShowtimes, showtimeFacets, toRow } from "../../services/showtime-query";
import { authedProcedure, isUniqueViolation, requireTheater, router } from "../init";

const tags = ["showtimes"];

export const showtimesRouter = router({
  list: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/showtimes",
        tags,
        protect: true,
        summary: "Search, filter, sort and page showtimes in your theaters",
      },
    })
    .input(ShowtimeListInput)
    .output(ShowtimeListOutput)
    .query(({ ctx, input }) => listShowtimes(ctx.tx, ctx.principal, input)),

  facets: authedProcedure
    .meta({ openapi: { method: "GET", path: "/showtimes/facets", tags, protect: true, summary: "Filter values" } })
    .input(ShowtimeFacetsInput)
    .output(ShowtimeFacets)
    .query(({ ctx, input }) => showtimeFacets(ctx.tx, ctx.principal, input.theaterId)),

  get: authedProcedure
    .meta({ openapi: { method: "GET", path: "/showtimes/{id}", tags, protect: true } })
    .input(IdInput)
    .output(ShowtimeRow)
    .query(async ({ ctx, input }) => {
      // RLS already hides rows outside the caller's theaters (and non-active rows from viewers).
      const [r] = await ctx.tx
        .select({ s: showtimes, theaterName: theaters.name })
        .from(showtimes)
        .innerJoin(theaters, eq(theaters.id, showtimes.theaterId))
        .where(eq(showtimes.id, input.id));
      const role = r ? ctx.principal.theaterRoles[r.s.theaterId] : undefined;
      if (!r || !role || (role === "viewer" && r.s.status !== "active")) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Showtime not found" });
      }
      return toRow(r.s, r.theaterName, role === "admin");
    }),

  update: authedProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/showtimes/{id}",
        tags,
        protect: true,
        summary: "Admin: change movie status or showtime status",
      },
    })
    .input(ShowtimeUpdateInput)
    .output(ShowtimeAdminRow)
    .mutation(async ({ ctx, input }) => {
      const [current] = await ctx.tx
        .select({ s: showtimes, theaterName: theaters.name })
        .from(showtimes)
        .innerJoin(theaters, eq(theaters.id, showtimes.theaterId))
        .where(eq(showtimes.id, input.id));
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Showtime not found" });
      requireTheater(ctx, current.s.theaterId, "showtime.update");
      if (current.s.version !== input.expectedVersion) {
        throw new TRPCError({ code: "CONFLICT", message: "This showtime changed since you loaded it. Refresh and try again." });
      }

      const patch: Partial<typeof showtimes.$inferInsert> = { version: current.s.version + 1 };
      if (input.movieStatus) patch.movieStatus = input.movieStatus;
      if (input.status) {
        patch.status = input.status;
        patch.archivedAt = input.status === "archived" ? new Date() : null;
      }
      let updated;
      try {
        [updated] = await ctx.tx.update(showtimes).set(patch).where(eq(showtimes.id, input.id)).returning();
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another active showtime already exists for this movie and start time",
          });
        }
        throw e;
      }
      if (input.status) {
        await ctx.tx
          .update(theaters)
          .set({ scheduleVersion: sql`${theaters.scheduleVersion} + 1` })
          .where(eq(theaters.id, current.s.theaterId));
      }
      await audit(ctx, {
        action: "showtime.update",
        entityType: "showtime",
        entityId: input.id,
        theaterId: current.s.theaterId,
        before: { movieStatus: current.s.movieStatus, status: current.s.status },
        after: { movieStatus: updated!.movieStatus, status: updated!.status },
      });
      return toRow(updated!, current.theaterName, true) as ShowtimeAdminRow;
    }),

  archiveAll: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/theaters/{theaterId}/schedule/archive",
        tags,
        protect: true,
        summary: "Admin: archive every showtime in a theater (Clear Schedule)",
      },
    })
    .input(ArchiveAllInput)
    .output(ArchiveAllOutput)
    .mutation(async ({ ctx, input }) => {
      requireTheater(ctx, input.theaterId, "schedule.archiveAll");
      const rows = await ctx.tx
        .update(showtimes)
        .set({ status: "archived", archivedAt: new Date(), version: sql`${showtimes.version} + 1` })
        .where(and(eq(showtimes.theaterId, input.theaterId), ne(showtimes.status, "archived")))
        .returning({ id: showtimes.id });
      await ctx.tx
        .update(theaters)
        .set({ scheduleVersion: sql`${theaters.scheduleVersion} + 1` })
        .where(eq(theaters.id, input.theaterId));
      await audit(ctx, {
        action: "schedule.archive_all",
        entityType: "theater",
        entityId: input.theaterId,
        theaterId: input.theaterId,
        after: { archived: rows.length },
      });
      return { archived: rows.length };
    }),
});
