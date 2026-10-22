/**
 * CSV import: upload -> clean -> reconcile -> preview (persisted) -> apply.
 * Parsing and matching live in ../csv (pure, unit tested). This file does the
 * database side: loading what to compare against, storing the preview, and
 * applying it in one transaction.
 */
import { createHash } from "node:crypto";
import type { ImportDetail, ImportSummary } from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { CsvFileError, type ExistingShowtime, parseShowtimeCsv, reconcile, type ReconciledRow } from "../csv";
import type { Tx } from "../db/client";
import { imports, importRows, type NormalizedRow, showtimes, theaters, users } from "../db/schema";
import type { AuthedContext } from "../trpc/init";
import { audit } from "./audit";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const DETAIL_ROW_CAP = 5000;
const CHUNK = 1000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizedOf(row: ReconciledRow): NormalizedRow | null {
  const v = row.value;
  if (!v) return null;
  return {
    movieTitle: v.movieTitle,
    movieTitleKey: v.movieTitleKey,
    auditorium: v.auditorium,
    auditoriumKey: v.auditoriumKey,
    startTime: v.startTime.toISOString(),
    endTime: v.endTime.toISOString(),
    language: v.language,
    format: v.format,
    rating: v.rating,
    lastUpdated: v.lastUpdated?.toISOString() ?? null,
  };
}

/** Existing rows to compare against: everything not archived, plus archived rows at the file's start times. */
async function loadExisting(tx: Tx, theaterId: string, startTimes: Date[]): Promise<ExistingShowtime[]> {
  const cols = {
    id: showtimes.id,
    movieTitle: showtimes.movieTitle,
    movieTitleKey: showtimes.movieTitleKey,
    auditorium: showtimes.auditorium,
    startTime: showtimes.startTime,
    endTime: showtimes.endTime,
    language: showtimes.language,
    format: showtimes.format,
    rating: showtimes.rating,
    status: showtimes.status,
    sourceUpdatedAt: showtimes.sourceUpdatedAt,
  };
  const live = await tx
    .select(cols)
    .from(showtimes)
    .where(and(eq(showtimes.theaterId, theaterId), ne(showtimes.status, "archived")));
  const archived: ExistingShowtime[] = [];
  const unique = [...new Set(startTimes.map((d) => d.toISOString()))];
  for (const part of chunks(unique)) {
    archived.push(
      ...(await tx
        .select(cols)
        .from(showtimes)
        .where(
          and(
            eq(showtimes.theaterId, theaterId),
            eq(showtimes.status, "archived"),
            sql`${showtimes.startTime} = any(${sql.raw("array[")}${sql.join(
              part.map((iso) => sql`${iso}::timestamptz`),
              sql`, `,
            )}${sql.raw("]")})`,
          ),
        )),
    );
  }
  return [...live, ...archived];
}

export async function createImport(
  ctx: AuthedContext,
  input: { theaterId: string; filename: string; contentBase64: string },
): Promise<ImportDetail> {
  const { tx } = ctx;
  const [theater] = await tx.select().from(theaters).where(eq(theaters.id, input.theaterId));
  if (!theater) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });

  const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
  let parsed;
  try {
    parsed = parseShowtimeCsv(bytes, { theaterName: theater.name, timezone: theater.timezone });
  } catch (e) {
    if (e instanceof CsvFileError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message, cause: e });
    throw e;
  }

  const startTimes = parsed.rows.flatMap((r) => (r.value ? [r.value.startTime] : []));
  const existing = await loadExisting(tx, theater.id, startTimes);
  const result = reconcile(parsed.rows, existing);
  const activeBefore = existing.filter((s) => s.status === "active").length;

  const notices = [...parsed.notices];
  const sha = createHash("sha256").update(bytes).digest("hex");
  const [sameFile] = await tx
    .select({ appliedAt: imports.appliedAt })
    .from(imports)
    .where(and(eq(imports.theaterId, theater.id), eq(imports.fileSha256, sha), eq(imports.status, "applied")))
    .orderBy(desc(imports.appliedAt))
    .limit(1);
  if (sameFile?.appliedAt) {
    notices.push(`This exact file was already applied on ${sameFile.appliedAt.toISOString().slice(0, 10)}.`);
  }
  if (activeBefore > 0 && result.counts.archive > activeBefore / 2) {
    notices.push(
      `This drop archives ${result.counts.archive} of ${activeBefore} active showtimes. You'll be asked to confirm.`,
    );
  }

  const [created] = await tx
    .insert(imports)
    .values({
      theaterId: theater.id,
      uploadedBy: ctx.user.id,
      filename: input.filename,
      fileSha256: sha,
      byteSize: bytes.byteLength,
      baseScheduleVersion: theater.scheduleVersion,
      totalRows: result.rows.length,
      addCount: result.counts.add,
      updateCount: result.counts.update,
      unchangedCount: result.counts.unchanged,
      archiveCount: result.counts.archive,
      duplicateCount: result.counts.duplicate,
      rejectedCount: result.counts.rejected,
      activeBefore,
      notices,
      archiveShowtimeIds: result.archives.map((a) => a.id),
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    })
    .returning();

  for (const part of chunks(result.rows)) {
    await tx.insert(importRows).values(
      part.map((r) => ({
        importId: created!.id,
        lineNumber: r.lineNumber,
        raw: r.raw,
        normalized: normalizedOf(r),
        outcome: r.outcome,
        showtimeId: r.showtimeId,
        matchMethod: r.matchMethod,
        diffs: r.diffs,
        errors: r.errors,
        warnings: r.warnings,
      })),
    );
  }
  await audit(ctx, {
    action: "import.preview",
    entityType: "import",
    entityId: created!.id,
    theaterId: theater.id,
    after: { filename: input.filename, ...result.counts },
  });
  return getImportDetail(ctx, created!.id);
}

async function loadImport(tx: Tx, id: string) {
  const [row] = await tx
    .select({ i: imports, theaterName: theaters.name, scheduleVersion: theaters.scheduleVersion, uploader: users.name })
    .from(imports)
    .innerJoin(theaters, eq(theaters.id, imports.theaterId))
    .innerJoin(users, eq(users.id, imports.uploadedBy))
    .where(eq(imports.id, id));
  // RLS returns nothing for non-admins, so "not yours" and "doesn't exist" look the same.
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Import not found" });
  return row;
}

function summaryOf(row: Awaited<ReturnType<typeof loadImport>>): ImportSummary {
  const { i } = row;
  const stale =
    i.status === "previewed" && (row.scheduleVersion !== i.baseScheduleVersion || i.expiresAt.getTime() < Date.now());
  return {
    id: i.id,
    theaterId: i.theaterId,
    theaterName: row.theaterName,
    filename: i.filename,
    status: stale ? "stale" : i.status,
    uploadedBy: row.uploader,
    createdAt: i.createdAt.toISOString(),
    appliedAt: i.appliedAt?.toISOString() ?? null,
    expiresAt: i.expiresAt.toISOString(),
    totalRows: i.totalRows,
    addCount: i.addCount,
    updateCount: i.updateCount,
    unchangedCount: i.unchangedCount,
    archiveCount: i.archiveCount,
    duplicateCount: i.duplicateCount,
    rejectedCount: i.rejectedCount,
    notices: i.notices,
    activeBefore: i.activeBefore,
  };
}

export async function getImportDetail(ctx: AuthedContext, id: string): Promise<ImportDetail> {
  const row = await loadImport(ctx.tx, id);
  const rows = await ctx.tx
    .select()
    .from(importRows)
    .where(eq(importRows.importId, id))
    .orderBy(asc(importRows.lineNumber))
    .limit(DETAIL_ROW_CAP);
  const archiveIds = row.i.archiveShowtimeIds.slice(0, DETAIL_ROW_CAP);
  const archived = archiveIds.length
    ? await ctx.tx
        .select({
          id: showtimes.id,
          movieTitle: showtimes.movieTitle,
          auditorium: showtimes.auditorium,
          startTime: showtimes.startTime,
          endTime: showtimes.endTime,
        })
        .from(showtimes)
        .where(inArray(showtimes.id, archiveIds))
        .orderBy(asc(showtimes.startTime))
    : [];
  return {
    summary: summaryOf(row),
    rows: rows.map((r) => ({
      lineNumber: r.lineNumber,
      outcome: r.outcome,
      showtimeId: r.showtimeId,
      matchMethod: r.matchMethod,
      movieTitle: r.normalized?.movieTitle ?? null,
      auditorium: r.normalized?.auditorium ?? null,
      startTime: r.normalized?.startTime ?? null,
      endTime: r.normalized?.endTime ?? null,
      diffs: r.diffs,
      errors: r.errors,
      warnings: r.warnings,
      raw: r.raw,
    })),
    archives: archived.map((a) => ({
      showtimeId: a.id,
      movieTitle: a.movieTitle,
      auditorium: a.auditorium,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
    })),
  };
}

export async function listImports(ctx: AuthedContext, theaterId: string): Promise<ImportSummary[]> {
  const rows = await ctx.tx
    .select({ i: imports, theaterName: theaters.name, scheduleVersion: theaters.scheduleVersion, uploader: users.name })
    .from(imports)
    .innerJoin(theaters, eq(theaters.id, imports.theaterId))
    .innerJoin(users, eq(users.id, imports.uploadedBy))
    .where(eq(imports.theaterId, theaterId))
    .orderBy(desc(imports.createdAt))
    .limit(50);
  return rows.map(summaryOf);
}

export async function discardImport(ctx: AuthedContext, id: string) {
  const row = await loadImport(ctx.tx, id);
  if (row.i.status !== "previewed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This import is already ${row.i.status}` });
  }
  await ctx.tx.update(imports).set({ status: "discarded" }).where(eq(imports.id, id));
  await audit(ctx, { action: "import.discard", entityType: "import", entityId: id, theaterId: row.i.theaterId });
  return getImportDetail(ctx, id);
}

export async function applyImport(ctx: AuthedContext, id: string, confirmLargeArchive: boolean) {
  const { tx } = ctx;
  const first = await loadImport(tx, id);
  const theaterId = first.i.theaterId;
  // One apply per theater at a time. Released when the transaction ends.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"import:" + theaterId}))`);
  const row = await loadImport(tx, id);
  const imp = row.i;

  if (imp.status === "applied") return getImportDetail(ctx, id); // idempotent
  if (imp.status !== "previewed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This import is ${imp.status}` });
  }
  if (imp.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: "CONFLICT", message: "This preview expired. Upload the file again." });
  }
  if (row.scheduleVersion !== imp.baseScheduleVersion) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The schedule changed after this preview was made. Upload the file again to see current changes.",
    });
  }
  if (imp.activeBefore > 0 && imp.archiveCount > imp.activeBefore / 2 && !confirmLargeArchive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This archives ${imp.archiveCount} of ${imp.activeBefore} active showtimes. Confirm to continue.`,
    });
  }

  const now = new Date();
  // 1. Archive first so updated/added rows never collide with rows on their way out.
  for (const part of chunks(imp.archiveShowtimeIds)) {
    await tx
      .update(showtimes)
      .set({ status: "archived", archivedAt: now, version: sql`${showtimes.version} + 1`, lastImportId: id })
      .where(and(inArray(showtimes.id, part), ne(showtimes.status, "archived")));
  }

  const rows = await tx
    .select()
    .from(importRows)
    .where(and(eq(importRows.importId, id), inArray(importRows.outcome, ["add", "update", "unchanged"])));

  try {
    // 2. Updates (incl. reactivations) and unchanged rows, set-based via jsonb_to_recordset.
    const changes = rows.filter((r) => r.outcome !== "add" && r.showtimeId && r.normalized);
    for (const part of chunks(changes)) {
      const payload = part.map((r) => ({
        id: r.showtimeId,
        changed: r.outcome === "update",
        reactivate: r.matchMethod === "reactivated",
        ...r.normalized,
      }));
      await tx.execute(sql`
        update showtime s set
          movie_title      = case when v.changed then v."movieTitle" else s.movie_title end,
          movie_title_key  = case when v.changed then v."movieTitleKey" else s.movie_title_key end,
          auditorium       = case when v.changed then v.auditorium else s.auditorium end,
          auditorium_key   = case when v.changed then v."auditoriumKey" else s.auditorium_key end,
          end_time         = case when v.changed then v."endTime" else s.end_time end,
          language         = case when v.changed then v.language else s.language end,
          format           = case when v.changed then v.format else s.format end,
          rating           = case when v.changed then v.rating else s.rating end,
          status           = case when v.reactivate then 'active'::showtime_status else s.status end,
          archived_at      = case when v.reactivate then null else s.archived_at end,
          source_updated_at = coalesce(v."lastUpdated", s.source_updated_at),
          last_import_id   = ${id},
          version          = case when v.changed then s.version + 1 else s.version end,
          updated_at       = case when v.changed then now() else s.updated_at end
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as v(
          id text, changed boolean, reactivate boolean,
          "movieTitle" text, "movieTitleKey" text, auditorium text, "auditoriumKey" text,
          "endTime" timestamptz, language text, format text, rating text, "lastUpdated" timestamptz
        )
        where s.id = v.id and s.theater_id = ${theaterId}`);
    }

    // 3. Adds. New movies start as needs-review; admins approve them.
    const adds = rows.filter((r) => r.outcome === "add" && r.normalized);
    for (const part of chunks(adds)) {
      await tx.insert(showtimes).values(
        part.map((r) => {
          const n = r.normalized!;
          return {
            theaterId,
            movieTitle: n.movieTitle,
            movieTitleKey: n.movieTitleKey,
            auditorium: n.auditorium,
            auditoriumKey: n.auditoriumKey,
            startTime: new Date(n.startTime),
            endTime: new Date(n.endTime),
            language: n.language,
            format: n.format,
            rating: n.rating,
            sourceUpdatedAt: n.lastUpdated ? new Date(n.lastUpdated) : null,
            lastImportId: id,
          };
        }),
      );
    }
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "23505" || err.cause?.code === "23505") {
      // The partial unique index is the final backstop for "one active showtime per movie + start".
      throw new TRPCError({
        code: "CONFLICT",
        message: "Applying would create two active showtimes for the same movie and start time. Nothing was changed.",
      });
    }
    throw e;
  }

  await tx
    .update(theaters)
    .set({ scheduleVersion: sql`${theaters.scheduleVersion} + 1` })
    .where(eq(theaters.id, theaterId));
  await tx.update(imports).set({ status: "applied", appliedAt: now, appliedBy: ctx.user.id }).where(eq(imports.id, id));
  await audit(ctx, {
    action: "import.apply",
    entityType: "import",
    entityId: id,
    theaterId,
    after: {
      filename: imp.filename,
      add: imp.addCount,
      update: imp.updateCount,
      unchanged: imp.unchangedCount,
      archive: imp.archiveCount,
      duplicate: imp.duplicateCount,
      rejected: imp.rejectedCount,
    },
  });
  return getImportDetail(ctx, id);
}
