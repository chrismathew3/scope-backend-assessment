/**
 * Compares parsed CSV rows with a theater's current schedule and decides, per row,
 * add / update / unchanged / duplicate / rejected, plus which showtimes to archive.
 *
 * Identity of a showtime = (title key, start time). Auditorium is not part of it,
 * so a renamed auditorium is an update, never an add + archive.
 */
import { computeDiffs, differingFields, keyOf, sameShowtime, similarTitles } from "./match";
import { trigramSimilarity } from "./normalize";
import type { ExistingShowtime, MatchMethod, ParsedRow, ReconciledRow, ReconcileResult, RowOutcome } from "./types";

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

function exactMatch(row: ReconciledRow, pool: Pool, claimed: Set<string>): ExistingShowtime | null {
  const v = row.value!;
  const candidates = (pool.get(v.startTime.getTime()) ?? []).filter((s) => !claimed.has(s.id) && s.movieTitleKey === v.movieTitleKey);
  // Prefer an active row if an inactive one shares the key.
  return candidates.find((s) => s.status === "active") ?? candidates[0] ?? null;
}

function fuzzyMatch(row: ReconciledRow, pool: Pool, claimed: Set<string>): FuzzyResult {
  const key = row.value!.movieTitleKey;
  let best: ExistingShowtime[] = [];
  let bestScore = 0;
  for (const s of pool.get(row.value!.startTime.getTime()) ?? []) {
    // Same numbers ("Kung Fu Panda 4" is not "3"), no conflicting subtitle words, similar enough.
    if (claimed.has(s.id) || !similarTitles(key, s.movieTitleKey)) continue;
    const score = trigramSimilarity(key, s.movieTitleKey);
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

/** Of two rows for the same showtime, keep the one the partner updated last; ties keep the earlier line. */
const newer = (a: ReconciledRow, b: ReconciledRow) => (b.value!.lastUpdated?.getTime() ?? -Infinity) > (a.value!.lastUpdated?.getTime() ?? -Infinity);

function markDuplicate(row: ReconciledRow, kept: ReconciledRow, sameKey: boolean, why = "") {
  row.outcome = "duplicate";
  row.duplicateOf = kept.lineNumber;
  row.showtimeId = null;
  row.matchMethod = null;
  row.diffs = [];
  const differing = differingFields(kept.value!, row.value!);
  const message = !sameKey
    ? `Same film and start time as line ${kept.lineNumber} ("${kept.value!.movieTitle}"); kept line ${kept.lineNumber}${why}.`
    : differing.length === 0
      ? `Duplicate of line ${kept.lineNumber}; skipped${why ? `, kept line ${kept.lineNumber}${why}` : ""}.`
      : `Same movie and start time as line ${kept.lineNumber} but different ${differing.join(", ")}; kept line ${kept.lineNumber}${why}.`;
  row.warnings.push({ column: "*", message });
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
    duplicateOf: null,
  }));

  // 1. Dedupe inside the file by (title key, start). The newer last_updated wins, else the first line.
  const keptByKey = new Map<string, ReconciledRow>();
  for (const row of out) {
    if (!row.value) continue;
    const key = keyOf(row.value.movieTitleKey, row.value.startTime);
    const kept = keptByKey.get(key);
    if (!kept) keptByKey.set(key, row);
    else if (newer(kept, row)) keptByKey.set(key, row);
  }
  for (const row of out) {
    if (!row.value) continue;
    const kept = keptByKey.get(keyOf(row.value.movieTitleKey, row.value.startTime))!;
    if (kept !== row) markDuplicate(row, kept, true, kept.lineNumber > row.lineNumber ? " (it has the newer last_updated)" : "");
  }

  const candidates = out.filter((r) => r.outcome === "add" && r.value);

  const claim = (row: ReconciledRow, s: ExistingShowtime, method: MatchMethod) => {
    claimed.add(s.id);
    row.showtimeId = s.id;
    row.matchMethod = method;
    row.diffs = computeDiffs(s, row.value!);
    row.outcome = row.diffs.length > 0 ? "update" : "unchanged";
    if (row.value!.lastUpdated && s.sourceUpdatedAt && row.value!.lastUpdated < s.sourceUpdatedAt) {
      row.warnings.push({ column: "last_updated", message: "Feed data is older than what is stored." });
    }
  };

  // 2. Exact matches first, so a fuzzy guess can't steal a showtime another row matches exactly.
  for (const row of candidates) {
    const s = exactMatch(row, live, claimed);
    if (s) claim(row, s, "exact_key");
  }

  // 3. Fuzzy title at the same start time.
  for (const row of candidates) {
    if (row.showtimeId) continue;
    const res = fuzzyMatch(row, live, claimed);
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
    const exact = exactMatch(row, archived, claimed);
    if (exact) {
      claim(row, exact, "reactivated");
      continue;
    }
    const res = fuzzyMatch(row, archived, claimed);
    if (res && "match" in res) claim(row, res.match, "reactivated");
  }

  // 5. An add must not be a second active copy of a film another row already covers at that start
  //    ("Spiderman Homecoming" next to "Spider-Man: Homecoming"). It becomes that row's duplicate.
  const byId = new Map(existing.map((s) => [s.id, s]));
  const active = out.filter((r) => r.value && (r.outcome === "update" || r.outcome === "unchanged"));
  const covers = (a: ReconciledRow, row: ReconciledRow) => {
    const stored = a.showtimeId ? byId.get(a.showtimeId) : undefined;
    return sameShowtime(a.value!, row.value!) || (!!stored && sameShowtime({ ...stored, startTime: a.value!.startTime }, row.value!));
  };
  for (const row of candidates) {
    if (row.outcome !== "add") continue;
    const owner = active.find((a) => a !== row && covers(a, row));
    if (owner) markDuplicate(row, owner, false);
    else active.push(row);
  }

  const archives = existing.filter((s) => s.status !== "archived" && !claimed.has(s.id));

  const counts = { add: 0, update: 0, unchanged: 0, duplicate: 0, rejected: 0, archive: archives.length } as Record<
    RowOutcome,
    number
  > & { archive: number };
  for (const r of out) counts[r.outcome]++;

  return { rows: out, archives, counts };
}
