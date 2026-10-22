import {
  ArchiveAllInput,
  ArchiveAllOutput,
  IdInput,
  END_BEFORE_START,
  ShowtimeAdminRow,
  ShowtimeCreateInput,
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
import {
  auditSnapshot,
  DUPLICATE_ACTIVE,
  diffShowtime,
  normalizeShowtimeFields,
  ShowtimeFieldError,
} from "../../services/showtime-edit";
import { listShowtimes, showtimeFacets, toRow } from "../../services/showtime-query";
import { type AuthedContext, authedProcedure, isUniqueViolation, requireTheater, router } from "../init";

const tags = ["showtimes"];

function normalizeOrThrow(input: Parameters<typeof normalizeShowtimeFields>[0]) {
  try {
    return normalizeShowtimeFields(input);
  } catch (e) {
    if (e instanceof ShowtimeFieldError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

/** Runs a showtime write, turning the one-active-showtime-per-film-and-start rule into a clear 409. */
async function writeShowtime<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: DUPLICATE_ACTIVE });
    throw e;
  }
}

/** Imports compare against the schedule they previewed; any schedule write makes older previews stale. */
async function bumpScheduleVersion(ctx: AuthedContext, theaterId: string) {
  await ctx.tx
    .update(theaters)
    .set({ scheduleVersion: sql`${theaters.scheduleVersion} + 1` })
    .where(eq(theaters.id, theaterId));
}

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

  create: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/showtimes",
        tags,
        protect: true,
        summary: "Admin: add a showtime to one of your theaters",
        description:
          "Times are ISO 8601 with an offset. Text is cleaned the same way as CSV imports. " +
          "409 if another active showtime of the same film already starts at that time.",
      },
    })
    .input(ShowtimeCreateInput)
    .output(ShowtimeAdminRow)
    .mutation(async ({ ctx, input }) => {
      requireTheater(ctx, input.theaterId, "showtime.create");
      const [theater] = await ctx.tx
        .select({ name: theaters.name })
        .from(theaters)
        .where(eq(theaters.id, input.theaterId));
      if (!theater) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
      const fields = normalizeOrThrow(input);
      const [created] = await writeShowtime(() =>
        ctx.tx
          .insert(showtimes)
          .values({
            theaterId: input.theaterId,
            movieTitle: fields.movieTitle!,
            movieTitleKey: fields.movieTitleKey!,
            auditorium: fields.auditorium!,
            auditoriumKey: fields.auditoriumKey!,
            startTime: fields.startTime!,
            endTime: fields.endTime!,
            language: fields.language!,
            format: fields.format!,
            rating: fields.rating!,
            movieStatus: input.movieStatus,
            status: input.status,
            archivedAt: input.status === "archived" ? new Date() : null,
          })
          .returning(),
      );
      await bumpScheduleVersion(ctx, input.theaterId);
      await audit(ctx, {
        action: "showtime.create",
        entityType: "showtime",
        entityId: created!.id,
        theaterId: input.theaterId,
        after: auditSnapshot(created!),
      });
      return toRow(created!, theater.name, true) as ShowtimeAdminRow;
    }),

  update: authedProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/showtimes/{id}",
        tags,
        protect: true,
        summary: "Admin: edit a showtime (no hard delete: archive it instead)",
        description:
          "Send only the fields to change, plus the version you loaded (expectedVersion); a stale version is a 409. " +
          'There is no hard delete: set status to "archived" to take a showtime off the schedule. ' +
          "Viewers can't edit (403).",
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

      const patch = normalizeOrThrow(input);
      if (input.movieStatus) patch.movieStatus = input.movieStatus;
      if (input.status) patch.status = input.status;
      const start = patch.startTime ?? current.s.startTime;
      const end = patch.endTime ?? current.s.endTime;
      if (end.getTime() <= start.getTime()) throw new TRPCError({ code: "BAD_REQUEST", message: END_BEFORE_START });

      const { before, after, changed } = diffShowtime(current.s, patch);
      // Nothing actually differs: no write, no version bump, no audit noise.
      if (changed.length === 0) return toRow(current.s, current.theaterName, true) as ShowtimeAdminRow;

      const set: Partial<typeof showtimes.$inferInsert> = { version: current.s.version + 1 };
      for (const f of changed) Object.assign(set, { [f]: patch[f] });
      if (changed.includes("movieTitle")) set.movieTitleKey = patch.movieTitleKey;
      if (changed.includes("auditorium")) set.auditoriumKey = patch.auditoriumKey;
      if (changed.includes("status")) set.archivedAt = patch.status === "archived" ? new Date() : null;

      const [updated] = await writeShowtime(() =>
        ctx.tx.update(showtimes).set(set).where(eq(showtimes.id, input.id)).returning(),
      );
      // movieStatus is internal review state that imports don't compare; everything else is the schedule.
      if (changed.some((f) => f !== "movieStatus")) await bumpScheduleVersion(ctx, current.s.theaterId);
      await audit(ctx, {
        action: "showtime.update",
        entityType: "showtime",
        entityId: input.id,
        theaterId: current.s.theaterId,
        before,
        after,
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
      await bumpScheduleVersion(ctx, input.theaterId);
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
