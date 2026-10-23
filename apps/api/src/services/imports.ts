/**
 * CSV import: upload -> clean -> rules -> agent -> verify -> preview (persisted)
 * -> reviewer approves/rejects each action -> apply.
 *
 * Parsing and matching rules live in ../csv, the agent in ../ai/agent.ts, and
 * the checks on the agent's answer in ../ai/verify.ts. This file does the
 * database side.
 */
import { createHash } from "node:crypto";
import type { AgentRun, ImportDetail, ImportSummary } from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { runReconciliationAgent } from "../ai/agent";
import { resolveModel } from "../ai/model";
import { type FinalRow, mergeAgentReview } from "../ai/verify";
import { CsvFileError, type ExistingShowtime, parseShowtimeCsv, reconcile } from "../csv";
import type { Tx } from "../db/client";
import {
  AGENT_OFF,
  type ArchiveProposal,
  imports,
  importRows,
  type NormalizedRow,
  showtimes,
  theaters,
  users,
} from "../db/schema";
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

function normalizedOf(row: FinalRow): NormalizedRow | null {
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

const IMPORT_LIMIT = 30;
const IMPORT_WINDOW_MIN = 10;

export async function createImport(
  ctx: AuthedContext,
  input: { theaterId: string; filename: string; contentBase64: string },
): Promise<ImportDetail> {
  const { tx } = ctx;
  const [theater] = await tx.select().from(theaters).where(eq(theaters.id, input.theaterId));
  if (!theater) throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });

  // Every upload runs the model, which costs money: cap each account's pace.
  const [recent] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(imports)
    .where(and(eq(imports.uploadedBy, ctx.user.id), sql`${imports.createdAt} > now() - make_interval(mins => ${IMPORT_WINDOW_MIN})`));
  if ((recent?.n ?? 0) >= IMPORT_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You've uploaded ${IMPORT_LIMIT} files in the last ${IMPORT_WINDOW_MIN} minutes. Try again in a few minutes.`,
    });
  }

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
  const rules = reconcile(parsed.rows, existing);
  const activeBefore = existing.filter((s) => s.status === "active").length;

  // The agent runs before any write, so the transaction holds no row locks while it thinks.
  const resolved = resolveModel();
  const outcome = resolved
    ? await runReconciliationAgent(resolved, { theater: { name: theater.name, timezone: theater.timezone }, reconciled: rules, existing })
    : null;
  const merged = mergeAgentReview(rules, outcome?.review ?? null, existing, { timezone: theater.timezone });

  const agent: AgentRun = outcome
    ? {
        status: outcome.status,
        model: resolved!.label,
        summary: outcome.summary,
        error: outcome.error,
        durationMs: outcome.durationMs,
        overrides: merged.overrides,
        corrections: merged.corrections,
        trace: outcome.trace,
      }
    : { ...AGENT_OFF, trace: [{ kind: "note", label: "No AI model is configured, so the rules decided", detail: null }] };

  const notices = [...parsed.notices];
  // When every dated row is in the past (an old sample, a back-fill), say it once instead of on every row.
  const PAST = "Start time is in the past.";
  const dated = merged.rows.filter((r) => r.value);
  if (dated.length > 1 && dated.every((r) => r.warnings.some((w) => w.message === PAST))) {
    for (const r of merged.rows) r.warnings = r.warnings.filter((w) => w.message !== PAST);
    notices.push("Every showtime in this file is in the past.");
  }
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
  if (activeBefore > 0 && merged.counts.archive > activeBefore / 2) {
    notices.push(
      `This drop would archive ${merged.counts.archive} of ${activeBefore} active showtimes. You'll be asked to confirm.`,
    );
  }

  const archiveProposals: ArchiveProposal[] = merged.archives.map((a) => ({
    showtimeId: a.showtime.id,
    explanation: a.explanation,
    decisionSource: a.decisionSource,
    accepted: true,
  }));

  const [created] = await tx
    .insert(imports)
    .values({
      theaterId: theater.id,
      uploadedBy: ctx.user.id,
      filename: input.filename,
      fileSha256: sha,
      byteSize: bytes.byteLength,
      baseScheduleVersion: theater.scheduleVersion,
      totalRows: merged.rows.length,
      addCount: merged.counts.add,
      updateCount: merged.counts.update,
      unchangedCount: merged.counts.unchanged,
      archiveCount: merged.counts.archive,
      duplicateCount: merged.counts.duplicate,
      rejectedCount: merged.counts.rejected,
      activeBefore,
      notices,
      archiveShowtimeIds: archiveProposals.map((a) => a.showtimeId),
      archiveProposals,
      agent,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    })
    .returning();

  for (const part of chunks(merged.rows)) {
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
        explanation: r.explanation,
        confidence: r.confidence,
        decisionSource: r.decisionSource,
        aiOverrodeRules: r.aiOverrodeRules,
        duplicateOf: r.duplicateOf,
        accepted: true,
      })),
    );
  }
  await audit(ctx, {
    action: "import.preview",
    entityType: "import",
    entityId: created!.id,
    theaterId: theater.id,
    after: {
      filename: input.filename,
      ...merged.counts,
      agent: agent.status,
      model: agent.model,
      overrides: agent.overrides,
      corrections: agent.corrections,
    },
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
    agent: i.agent ?? AGENT_OFF,
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
  const proposals = row.i.archiveProposals.slice(0, DETAIL_ROW_CAP);
  const archived = proposals.length
    ? await ctx.tx
        .select({
          id: showtimes.id,
          movieTitle: showtimes.movieTitle,
          auditorium: showtimes.auditorium,
          startTime: showtimes.startTime,
          endTime: showtimes.endTime,
        })
        .from(showtimes)
        .where(
          inArray(
            showtimes.id,
            proposals.map((p) => p.showtimeId),
          ),
        )
        .orderBy(asc(showtimes.startTime))
    : [];
  const proposalById = new Map(proposals.map((p) => [p.showtimeId, p]));
  return {
    summary: summaryOf(row),
    rows: rows.map((r) => ({
      lineNumber: r.lineNumber,
      outcome: r.outcome,
      showtimeId: r.showtimeId,
      matchMethod: r.matchMethod,
      explanation: r.explanation,
      confidence: r.confidence,
      decisionSource: r.decisionSource,
      aiOverrodeRules: r.aiOverrodeRules,
      duplicateOf: r.duplicateOf,
      accepted: r.accepted,
      movieTitle: r.normalized?.movieTitle ?? null,
      auditorium: r.normalized?.auditorium ?? null,
      startTime: r.normalized?.startTime ?? null,
      endTime: r.normalized?.endTime ?? null,
      diffs: r.diffs,
      errors: r.errors,
      warnings: r.warnings,
      raw: r.raw,
    })),
    archives: archived.map((a) => {
      const p = proposalById.get(a.id)!;
      return {
        showtimeId: a.id,
        movieTitle: a.movieTitle,
        auditorium: a.auditorium,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        explanation: p.explanation,
        decisionSource: p.decisionSource,
        accepted: p.accepted,
      };
    }),
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

/** Turns a unique-index violation into a sentence naming the film and time. */
function conflictMessage(e: unknown, timezone: string): string | null {
  const err = e as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
  const code = err.code ?? err.cause?.code;
  if (code !== "23505") return null;
  const detail = err.detail ?? err.cause?.detail ?? "";
  const m = /=\([^,]+, (.+), (\d{4}-\d{2}-\d{2} [\d:.+-]+)\)/.exec(detail);
  if (m) {
    const when = new Date(m[2]!.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    const at = Number.isNaN(when.getTime())
      ? m[2]
      : when.toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `Applying would leave two active showtimes of "${m[1]}" at ${at}. Approve the archive of the old one, or reject the new one. Nothing was changed.`;
  }
  return "Applying would leave two active showtimes for the same film and start time. Nothing was changed.";
}

export async function applyImport(
  ctx: AuthedContext,
  id: string,
  confirmLargeArchive: boolean,
  decisions: { rows: { lineNumber: number; accepted: boolean }[]; archives: { showtimeId: string; accepted: boolean }[] },
) {
  const { tx } = ctx;
  const first = await loadImport(tx, id);
  const theaterId = first.i.theaterId;
  // One apply per theater at a time. Released when the transaction ends.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"import:" + theaterId}))`);
  const row = await loadImport(tx, id);
  const imp = row.i;
  const [theater] = await tx.select({ timezone: theaters.timezone }).from(theaters).where(eq(theaters.id, theaterId));
  const timezone = theater?.timezone ?? "UTC";

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

  // 1. Record the reviewer's choices. Only add/update rows and archives can be toggled.
  const rowChoice = new Map(decisions.rows.map((d) => [d.lineNumber, d.accepted]));
  const allRows = await tx.select().from(importRows).where(eq(importRows.importId, id));
  const toggleable = allRows.filter((r) => r.outcome === "add" || r.outcome === "update");
  const rejectLines = toggleable.filter((r) => rowChoice.get(r.lineNumber) === false).map((r) => r.lineNumber);
  const acceptLines = toggleable.filter((r) => rowChoice.get(r.lineNumber) === true && !r.accepted).map((r) => r.lineNumber);
  for (const part of chunks(rejectLines)) {
    await tx
      .update(importRows)
      .set({ accepted: false })
      .where(and(eq(importRows.importId, id), inArray(importRows.lineNumber, part)));
  }
  for (const part of chunks(acceptLines)) {
    await tx
      .update(importRows)
      .set({ accepted: true })
      .where(and(eq(importRows.importId, id), inArray(importRows.lineNumber, part)));
  }
  const archiveChoice = new Map(decisions.archives.map((d) => [d.showtimeId, d.accepted]));
  const proposals = imp.archiveProposals.map((p) => ({ ...p, accepted: archiveChoice.get(p.showtimeId) ?? p.accepted }));
  const acceptedArchives = proposals.filter((p) => p.accepted).map((p) => p.showtimeId);
  const rejectedLineSet = new Set(rejectLines);

  if (imp.activeBefore > 0 && acceptedArchives.length > imp.activeBefore / 2 && !confirmLargeArchive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This archives ${acceptedArchives.length} of ${imp.activeBefore} active showtimes. Confirm to continue.`,
    });
  }

  const now = new Date();
  try {
    // 2. Archive first, so moved, renamed or added rows never collide with rows on their way out.
    for (const part of chunks(acceptedArchives)) {
      await tx
        .update(showtimes)
        .set({ status: "archived", archivedAt: now, version: sql`${showtimes.version} + 1`, lastImportId: id })
        .where(and(inArray(showtimes.id, part), eq(showtimes.theaterId, theaterId), ne(showtimes.status, "archived")));
    }

    // 3. Approved updates (incl. moved and restored showtimes) and unchanged rows, set-based.
    const changes = allRows.filter(
      (r) =>
        (r.outcome === "update" && !rejectedLineSet.has(r.lineNumber) && (rowChoice.get(r.lineNumber) ?? r.accepted)) ||
        r.outcome === "unchanged",
    );
    for (const part of chunks(changes.filter((r) => r.showtimeId && r.normalized))) {
      const payload = part.map((r) => ({
        id: r.showtimeId,
        changed: r.outcome === "update",
        reactivate: r.diffs.some((d) => d.field === "status" && d.oldValue === "archived"),
        ...r.normalized,
      }));
      await tx.execute(sql`
        update showtime s set
          movie_title       = case when v.changed then v."movieTitle" else s.movie_title end,
          movie_title_key   = case when v.changed then v."movieTitleKey" else s.movie_title_key end,
          auditorium        = case when v.changed then v.auditorium else s.auditorium end,
          auditorium_key    = case when v.changed then v."auditoriumKey" else s.auditorium_key end,
          start_time        = case when v.changed then v."startTime" else s.start_time end,
          end_time          = case when v.changed then v."endTime" else s.end_time end,
          language          = case when v.changed then v.language else s.language end,
          format            = case when v.changed then v.format else s.format end,
          rating            = case when v.changed then v.rating else s.rating end,
          status            = case when v.reactivate then 'active'::showtime_status else s.status end,
          archived_at       = case when v.reactivate then null else s.archived_at end,
          source_updated_at = coalesce(v."lastUpdated", s.source_updated_at),
          last_import_id    = ${id},
          version           = case when v.changed then s.version + 1 else s.version end,
          updated_at        = case when v.changed then now() else s.updated_at end
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as v(
          id text, changed boolean, reactivate boolean,
          "movieTitle" text, "movieTitleKey" text, auditorium text, "auditoriumKey" text,
          "startTime" timestamptz, "endTime" timestamptz, language text, format text, rating text,
          "lastUpdated" timestamptz
        )
        where s.id = v.id and s.theater_id = ${theaterId}`);
    }

    // 4. Approved adds. New films start as needs-review; admins approve them.
    const adds = allRows.filter(
      (r) => r.outcome === "add" && r.normalized && !rejectedLineSet.has(r.lineNumber) && (rowChoice.get(r.lineNumber) ?? r.accepted),
    );
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
    // The partial unique index is the final backstop for "one active showtime per movie + start".
    const message = conflictMessage(e, timezone);
    if (message) throw new TRPCError({ code: "CONFLICT", message });
    throw e;
  }

  await tx
    .update(theaters)
    .set({ scheduleVersion: sql`${theaters.scheduleVersion} + 1` })
    .where(eq(theaters.id, theaterId));
  await tx
    .update(imports)
    .set({ status: "applied", appliedAt: now, appliedBy: ctx.user.id, archiveProposals: proposals })
    .where(eq(imports.id, id));

  const approved = toggleable.length - rejectLines.length;
  await audit(ctx, {
    action: "import.apply",
    entityType: "import",
    entityId: id,
    theaterId,
    after: {
      filename: imp.filename,
      approvedChanges: approved,
      rejectedChanges: rejectLines.length,
      archived: acceptedArchives.length,
      keptMissing: proposals.length - acceptedArchives.length,
      unchanged: imp.unchangedCount,
      duplicate: imp.duplicateCount,
      rejectedRows: imp.rejectedCount,
      agent: imp.agent?.status ?? "off",
      model: imp.agent?.model ?? null,
    },
  });
  return getImportDetail(ctx, id);
}
