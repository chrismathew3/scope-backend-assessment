/**
 * Compares parsed CSV rows with a theater's current schedule and decides, per row,
 * add / update / unchanged / duplicate / rejected, plus which showtimes to archive.
 *
 * Identity of a showtime = (title key, start time). Auditorium is not part of it,
 * so a renamed auditorium is an update, never an add + archive.
 */
import { digitTokens, trigramSimilarity } from "./normalize";
import type {
  CleanRow,
  ExistingShowtime,
  FieldDiff,
  MatchMethod,
  ParsedRow,
  ReconciledRow,
  ReconcileResult,
  RowOutcome,
} from "./types";

export const FUZZY_THRESHOLD = 0.6;

const COMPARED_FIELDS = ["movieTitle", "auditorium", "endTime", "language", "format", "rating"] as const;
type ComparedField = (typeof COMPARED_FIELDS)[number];

function fieldValue(v: Pick<CleanRow, ComparedField> | ExistingShowtime, field: ComparedField): string {
  const x = v[field];
  return x instanceof Date ? x.toISOString() : x;
}

function diffFields(existing: ExistingShowtime, row: CleanRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of COMPARED_FIELDS) {
    const oldValue = fieldValue(existing, field);
    const newValue = fieldValue(row, field);
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue });
  }
  return diffs;
}

const keyOf = (titleKey: string, start: Date) => `${titleKey}|${start.getTime()}`;

type Pool = Map<number, ExistingShowtime[]>; // start time ms -> showtimes

function poolOf(showtimes: ExistingShowtime[]): Pool {
  const pool: Pool = new Map();
  for (const s of showtimes) {
    const list = pool.get(s.startTime.getTime()) ?? [];
    list.push(s);
    pool.set(s.startTime.getTime(), list);
  }
  return pool;
}

type FuzzyResult = { match: ExistingShowtime } | { tie: ExistingShowtime[] } | null;

function exactMatch(row: CleanRow, pool: Pool, claimed: Set<string>): ExistingShowtime | null {
  const candidates = (pool.get(row.startTime.getTime()) ?? []).filter(
    (s) => !claimed.has(s.id) && s.movieTitleKey === row.movieTitleKey,
  );
  // Prefer an active row if an inactive one shares the key.
  return candidates.find((s) => s.status === "active") ?? candidates[0] ?? null;
}

function fuzzyMatch(row: CleanRow, pool: Pool, claimed: Set<string>): FuzzyResult {
  const digits = digitTokens(row.movieTitleKey).join(" ");
  let best: ExistingShowtime[] = [];
  let bestScore = 0;
  for (const s of pool.get(row.startTime.getTime()) ?? []) {
    if (claimed.has(s.id)) continue;
    // Sequels: "Kung Fu Panda 4" must never match "Kung Fu Panda 3".
    if (digitTokens(s.movieTitleKey).join(" ") !== digits) continue;
    const score = trigramSimilarity(row.movieTitleKey, s.movieTitleKey);
    if (score < FUZZY_THRESHOLD) continue;
    if (score > bestScore) {
      best = [s];
      bestScore = score;
    } else if (score === bestScore) {
      best.push(s);
    }
  }
  if (best.length === 0) return null;
  if (best.length > 1) return { tie: best };
  return { match: best[0]! };
}

export function reconcile(rows: ParsedRow[], existing: ExistingShowtime[]): ReconcileResult {
  const live = poolOf(existing.filter((s) => s.status !== "archived"));
  const archived = poolOf(existing.filter((s) => s.status === "archived"));
  const claimed = new Set<string>();

  const out: ReconciledRow[] = rows.map((r) => ({
    ...r,
    warnings: [...r.warnings],
    outcome: r.value ? "add" : "rejected",
    showtimeId: null,
    matchMethod: null,
    diffs: [],
  }));

  // 1. Dedupe inside the file: first occurrence of (title key, start) wins.
  const firstSeen = new Map<string, ReconciledRow>();
  for (const row of out) {
    if (!row.value) continue;
    const key = keyOf(row.value.movieTitleKey, row.value.startTime);
    const first = firstSeen.get(key);
    if (!first) {
      firstSeen.set(key, row);
      continue;
    }
    row.outcome = "duplicate";
    const differing = COMPARED_FIELDS.filter(
      (f) => fieldValue(first.value!, f) !== fieldValue(row.value!, f),
    );
    row.warnings.push({
      column: "*",
      message:
        differing.length === 0
          ? `Duplicate of line ${first.lineNumber}; skipped.`
          : `Same movie and start time as line ${first.lineNumber} but different ${differing.join(", ")}; kept line ${first.lineNumber}.`,
    });
  }

  const candidates = out.filter((r) => r.outcome === "add" && r.value);

  const claim = (row: ReconciledRow, s: ExistingShowtime, method: MatchMethod) => {
    claimed.add(s.id);
    row.showtimeId = s.id;
    row.matchMethod = method;
    const diffs = diffFields(s, row.value!);
    if (method === "reactivated") diffs.unshift({ field: "status", oldValue: "archived", newValue: "active" });
    row.diffs = diffs;
    row.outcome = diffs.length > 0 ? "update" : "unchanged";
    if (row.value!.lastUpdated && s.sourceUpdatedAt && row.value!.lastUpdated < s.sourceUpdatedAt) {
      row.warnings.push({ column: "last_updated", message: "Feed data is older than what is stored." });
    }
  };

  // 2. Exact matches first, so a fuzzy guess can't steal a showtime another row matches exactly.
  for (const row of candidates) {
    const s = exactMatch(row.value!, live, claimed);
    if (s) claim(row, s, "exact_key");
  }

  // 3. Fuzzy title at the same start time.
  for (const row of candidates) {
    if (row.showtimeId) continue;
    const res = fuzzyMatch(row.value!, live, claimed);
    if (!res) continue;
    if ("tie" in res) {
      row.warnings.push({
        column: "movie_title",
        message: `Could be any of: ${res.tie.map((s) => `"${s.movieTitle}"`).join(", ")}; added as new.`,
      });
      continue;
    }
    claim(row, res.match, "fuzzy_title");
  }

  // 4. A previously archived showtime that's back: reactivate it (keeps id and movie status).
  for (const row of candidates) {
    if (row.showtimeId) continue;
    const exact = exactMatch(row.value!, archived, claimed);
    if (exact) {
      claim(row, exact, "reactivated");
      continue;
    }
    const res = fuzzyMatch(row.value!, archived, claimed);
    if (res && "match" in res) claim(row, res.match, "reactivated");
  }

  const archives = existing.filter((s) => s.status !== "archived" && !claimed.has(s.id));

  const counts = { add: 0, update: 0, unchanged: 0, duplicate: 0, rejected: 0, archive: archives.length } as Record<
    RowOutcome,
    number
  > & { archive: number };
  for (const r of out) counts[r.outcome]++;

  return { rows: out, archives, counts };
}
