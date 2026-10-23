/**
 * Showtime search. Built for hundreds of thousands of rows:
 *  - theater scope + role rules become one WHERE clause (RLS enforces the same again)
 *  - title search matches the small title catalog with pg_trgm (substring + typo tolerance),
 *    then fetches showtimes by exact title key (b-tree), so cost tracks matches, not table size
 *  - filter values come from a skip scan over narrow indexes
 *  - keyset pagination (no OFFSET), count capped at 10,000
 * Measured on 500,000 showtimes: see docs/search-at-scale.md and src/scripts/bench-search.ts.
 */
import {
  ADMIN_ONLY_SORTS,
  type MovieStatus,
  type Principal,
  type ShowtimeAdminRow,
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
import { movieTitles, showtimes, theaters } from "../db/schema";

type ListInput = z.output<typeof ShowtimeListInput>;
const COUNT_CAP = 10_000;

/** Which theaters the query may touch, split by what the caller can see there. */
function scopeFor(p: Principal, theaterId?: string) {
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
function scopeCondition(adminIds: string[], viewerIds: string[]): SQL {
  const parts: SQL[] = [];
  if (adminIds.length) parts.push(inArray(showtimes.theaterId, adminIds));
  if (viewerIds.length) parts.push(and(inArray(showtimes.theaterId, viewerIds), eq(showtimes.status, "active"))!);
  return parts.length ? or(...parts)! : sql`false`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Most distinct titles a search can expand to. Past this the query is too vague to be useful. */
const MAX_TITLE_KEYS = 2_000;

/**
 * Title keys that match the search, from the title catalog: substring, or word
 * similarity for typos ("oppenhiemer" -> "oppenheimer"). Undefined when there is no search.
 */
async function matchTitleKeys(db: Queryable, q: string | undefined): Promise<string[] | undefined> {
  if (!q) return undefined;
  const key = titleKey(q);
  if (!key) return undefined;
  const contains = sql`${movieTitles.key} like ${"%" + escapeLike(key) + "%"}`;
  // Trigrams need 3+ characters; shorter input is a prefix match.
  const cond =
    key.length < 3 ? sql`${movieTitles.key} like ${escapeLike(key) + "%"}` : sql`(${contains} or ${key} <% ${movieTitles.key})`;
  // Default 0.6 misses swapped letters ("oppenhiemer" scores 0.5). Local to this transaction.
  await db.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.45', true)`);
  // The catalog spans every theater, so when the cap bites, keep the best matches:
  // substring hits first, then closest typos, then by key so the cut is stable.
  const rows = await db
    .select({ key: movieTitles.key })
    .from(movieTitles)
    .where(cond)
    .orderBy(desc(contains), desc(sql`word_similarity(${key}, ${movieTitles.key})`), asc(movieTitles.key))
    .limit(MAX_TITLE_KEYS);
  return rows.map((r) => r.key);
}

function searchCondition(titleKeys: string[] | undefined): SQL | undefined {
  if (!titleKeys) return undefined;
  return titleKeys.length ? inArray(showtimes.movieTitleKey, titleKeys) : sql`false`;
}

const sortColumns: Record<ShowtimeSort, SQL | AnyPgColumn> = {
  startTime: showtimes.startTime,
  endTime: showtimes.endTime,
  movieTitle: showtimes.movieTitleKey,
  theaterName: theaters.name,
  lastUpdated: showtimes.updatedAt,
  // Enum order is declared alphabetically, so the enum sorts like its text and uses its index.
  movieStatus: showtimes.movieStatus,
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

function filterConditions(
  input: ListInput,
  adminIds: string[],
  titleKeys?: string[],
): (SQL | undefined)[] {
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
    searchCondition(titleKeys),
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

  const titleKeys = await matchTitleKeys(db, input.q);
  const where = and(scopeCondition(adminIds, viewerIds), ...filterConditions(input, adminIds, titleKeys));
  const col = sortColumns[input.sort];
  const dir = input.order === "asc" ? asc : desc;

  let cursorCond: SQL | undefined;
  if (input.cursor) {
    const [v, id] = decodeCursor(input.cursor);
    const value = isTimeSort(input.sort)
      ? sql`${v}::timestamptz`
      : input.sort === "movieStatus"
        ? sql`${v}::movie_status`
        : sql`${v}`;
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

type ShowtimeRecord = typeof showtimes.$inferSelect;

function publicFields(s: ShowtimeRecord, theaterName: string) {
  return {
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
}

/** The admin shape: public fields plus internal state. */
export function toAdminRow(s: ShowtimeRecord, theaterName: string): ShowtimeAdminRow {
  return {
    access: "admin",
    ...publicFields(s, theaterName),
    movieStatus: s.movieStatus,
    status: s.status,
    lastUpdated: s.updatedAt.toISOString(),
    version: s.version,
  };
}

/** Shapes a row for the caller's role in that theater. Viewers never receive internal fields. */
export function toRow(s: ShowtimeRecord, theaterName: string, isAdmin: boolean): ShowtimeRow {
  return isAdmin ? toAdminRow(s, theaterName) : { access: "viewer", ...publicFields(s, theaterName) };
}

export async function showtimeFacets(db: Queryable, p: Principal, theaterId?: string) {
  const { inScope, adminIds } = scopeFor(p, theaterId);
  const empty = { formats: [], languages: [], ratings: [], auditoriums: [], movieStatuses: [], canSeeInternal: false };
  if (inScope.length === 0) return empty;
  // app_showtime_facet (migration 0007) applies the viewer/admin rule and skip-scans an index.
  // One connection per request transaction, so these run one after another; each takes a few ms.
  const facet = async (col: string) => {
    const rows = await db.execute<{ v: string }>(
      sql`select v from app_showtime_facet(${col}, ${sql`array[${sql.join(inScope.map((id) => sql`${id}`), sql`, `)}]::text[]`}) v`,
    );
    return rows.map((r) => r.v);
  };
  const formats = await facet("format");
  const languages = await facet("language");
  const ratings = await facet("rating");
  const auditoriums = await facet("auditorium");
  const movieStatuses = adminIds.length ? ((await facet("movie_status")) as MovieStatus[]) : [];
  return { formats, languages, ratings, auditoriums, movieStatuses, canSeeInternal: adminIds.length > 0 };
}
