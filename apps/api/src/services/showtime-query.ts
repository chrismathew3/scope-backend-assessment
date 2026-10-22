/**
 * Showtime search. Built for hundreds of thousands of rows:
 *  - theater scope + role rules become one WHERE clause (RLS enforces the same again)
 *  - title search uses the pg_trgm GIN index (substring + typo tolerance)
 *  - keyset pagination (no OFFSET), count capped at 10,000
 */
import {
  ADMIN_ONLY_SORTS,
  type Principal,
  type ShowtimeRow,
  type ShowtimeSort,
  ShowtimeListInput,
  theatersWhere,
} from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { titleKey } from "../csv";
import type { Queryable } from "../db/client";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { showtimes, theaters } from "../db/schema";

type ListInput = z.output<typeof ShowtimeListInput>;
const COUNT_CAP = 10_000;

/** Which theaters the query may touch, split by what the caller can see there. */
export function scopeFor(p: Principal, theaterId?: string) {
  const member = Object.keys(p.theaterRoles);
  if (theaterId && !member.includes(theaterId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
  }
  const inScope = theaterId ? [theaterId] : member;
  const adminIds = theatersWhere(p, "showtime.readInternal").filter((id) => inScope.includes(id));
  const viewerIds = inScope.filter((id) => !adminIds.includes(id));
  return { inScope, adminIds, viewerIds };
}

/** Admin theaters: every row. Viewer theaters: active rows only. */
export function scopeCondition(adminIds: string[], viewerIds: string[]): SQL {
  const parts: SQL[] = [];
  if (adminIds.length) parts.push(inArray(showtimes.theaterId, adminIds));
  if (viewerIds.length) parts.push(and(inArray(showtimes.theaterId, viewerIds), eq(showtimes.status, "active"))!);
  return parts.length ? or(...parts)! : sql`false`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const key = titleKey(q);
  if (!key) return undefined;
  // Trigrams need 3+ characters; shorter input is a prefix match.
  if (key.length < 3) return sql`${showtimes.movieTitleKey} like ${escapeLike(key) + "%"}`;
  // Substring match, or word similarity for typos ("spidr" -> "spider man homecoming").
  // `<%` compares the query to the best-matching stretch of the title; same GIN index.
  return or(
    sql`${showtimes.movieTitleKey} like ${"%" + escapeLike(key) + "%"}`,
    sql`${key} <% ${showtimes.movieTitleKey}`,
  );
}

const sortColumns: Record<ShowtimeSort, SQL | AnyPgColumn> = {
  startTime: showtimes.startTime,
  endTime: showtimes.endTime,
  movieTitle: showtimes.movieTitleKey,
  theaterName: theaters.name,
  lastUpdated: showtimes.updatedAt,
  movieStatus: sql`${showtimes.movieStatus}::text`,
};
const isTimeSort = (s: ShowtimeSort) => s === "startTime" || s === "endTime" || s === "lastUpdated";

function encodeCursor(value: unknown, id: string) {
  const v = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(JSON.stringify([v, id])).toString("base64url");
}
function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((x) => typeof x === "string")) {
      return parsed as [string, string];
    }
  } catch {
    // fall through
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
}

export function filterConditions(input: ListInput, adminIds: string[]): (SQL | undefined)[] {
  return [
    input.status !== "all" ? eq(showtimes.status, input.status) : undefined,
    // movieStatus is hidden from viewers, so filtering on it only ever matches admin theaters.
    input.movieStatus
      ? adminIds.length
        ? and(inArray(showtimes.theaterId, adminIds), eq(showtimes.movieStatus, input.movieStatus))
        : sql`false`
      : undefined,
    input.format ? eq(showtimes.format, input.format) : undefined,
    input.language ? eq(showtimes.language, input.language) : undefined,
    input.rating ? eq(showtimes.rating, input.rating) : undefined,
    input.auditorium ? eq(showtimes.auditorium, input.auditorium) : undefined,
    input.from ? gte(showtimes.startTime, new Date(input.from)) : undefined,
    input.to ? lte(showtimes.startTime, new Date(input.to)) : undefined,
    searchCondition(input.q),
  ];
}

export async function listShowtimes(db: Queryable, p: Principal, input: ListInput) {
  const { inScope, adminIds, viewerIds } = scopeFor(p, input.theaterId);
  if (inScope.length === 0) return { items: [], nextCursor: null, total: 0, totalCapped: false };
  if (ADMIN_ONLY_SORTS.includes(input.sort) && viewerIds.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Sorting by ${input.sort} needs admin access to every theater shown`,
    });
  }

  if (input.q) {
    // Default 0.6 misses swapped letters ("oppenhiemer" scores 0.5). Local to this transaction.
    await db.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.45', true)`);
  }
  const where = and(scopeCondition(adminIds, viewerIds), ...filterConditions(input, adminIds));
  const col = sortColumns[input.sort];
  const dir = input.order === "asc" ? asc : desc;

  let cursorCond: SQL | undefined;
  if (input.cursor) {
    const [v, id] = decodeCursor(input.cursor);
    const value = isTimeSort(input.sort) ? sql`${v}::timestamptz` : sql`${v}`;
    cursorCond =
      input.order === "asc"
        ? sql`(${col}, ${showtimes.id}) > (${value}, ${id})`
        : sql`(${col}, ${showtimes.id}) < (${value}, ${id})`;
  }

  const rows = await db
    .select({
      s: showtimes,
      theaterName: theaters.name,
      sortValue: sql<unknown>`${col}`.as("sort_value"),
    })
    .from(showtimes)
    .innerJoin(theaters, eq(theaters.id, showtimes.theaterId))
    .where(and(where, cursorCond))
    .orderBy(dir(col), dir(showtimes.id))
    .limit(input.limit + 1);

  const [countRow] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select 1 from ${showtimes} inner join ${theaters} on ${theaters.id} = ${showtimes.theaterId}
      where ${where} limit ${COUNT_CAP + 1}
    ) capped`);
  const total = Math.min(countRow?.n ?? 0, COUNT_CAP);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const adminSet = new Set(adminIds);
  return {
    items: page.map((r) => toRow(r.s, r.theaterName, adminSet.has(r.s.theaterId))),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.sortValue, last.s.id) : null,
    total,
    totalCapped: (countRow?.n ?? 0) > COUNT_CAP,
  };
}

/** Shapes a row for the caller's role in that theater. Viewers never receive internal fields. */
export function toRow(s: typeof showtimes.$inferSelect, theaterName: string, isAdmin: boolean): ShowtimeRow {
  const base = {
    id: s.id,
    theaterId: s.theaterId,
    theaterName,
    movieTitle: s.movieTitle,
    auditorium: s.auditorium,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime.toISOString(),
    language: s.language,
    format: s.format,
    rating: s.rating,
  };
  if (!isAdmin) return { access: "viewer", ...base };
  return {
    access: "admin",
    ...base,
    movieStatus: s.movieStatus,
    status: s.status,
    lastUpdated: s.updatedAt.toISOString(),
    version: s.version,
  };
}

export async function showtimeFacets(db: Queryable, p: Principal, theaterId?: string) {
  const { inScope, adminIds, viewerIds } = scopeFor(p, theaterId);
  const empty = { formats: [], languages: [], ratings: [], auditoriums: [], movieStatuses: [], canSeeInternal: false };
  if (inScope.length === 0) return empty;
  const where = scopeCondition(adminIds, viewerIds);
  type TextColumn = typeof showtimes.format | typeof showtimes.language | typeof showtimes.rating | typeof showtimes.auditorium;
  const distinct = async (column: TextColumn): Promise<string[]> => {
    const rows = await db.selectDistinct({ v: sql<string>`${column}` }).from(showtimes).where(where).orderBy(column);
    return rows.map((r) => r.v);
  };
  const [formats, languages, ratings, auditoriums] = await Promise.all([
    distinct(showtimes.format),
    distinct(showtimes.language),
    distinct(showtimes.rating),
    distinct(showtimes.auditorium),
  ]);
  let movieStatuses: (typeof showtimes.$inferSelect)["movieStatus"][] = [];
  if (adminIds.length) {
    const rows = await db
      .selectDistinct({ v: showtimes.movieStatus })
      .from(showtimes)
      .where(inArray(showtimes.theaterId, adminIds))
      .orderBy(showtimes.movieStatus);
    movieStatuses = rows.map((r) => r.v);
  }
  return { formats, languages, ratings, auditoriums, movieStatuses, canSeeInternal: adminIds.length > 0 };
}
