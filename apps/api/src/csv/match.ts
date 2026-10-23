/**
 * What "same film" and "same showtime" mean. Shared by the rules (reconcile.ts)
 * and the checks on the agent's answer (../ai/verify.ts), so both use one definition.
 * Pure functions on title keys (see titleKey in normalize.ts).
 */
import { digitTokens, trigramSimilarity } from "./normalize";
import type { CleanRow, ExistingShowtime, FieldDiff } from "./types";

/** Trigram similarity at or above which two different title keys can be the same film. */
export const FUZZY_THRESHOLD = 0.6;

const COMPARED_FIELDS = ["movieTitle", "auditorium", "endTime", "language", "format", "rating"] as const;

/** Identity of a showtime: title key + start. */
export const keyOf = (titleKey: string, start: Date) => `${titleKey}|${start.getTime()}`;

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);

/** Field-by-field changes from a stored showtime to a file row. Restoring an archived one is a status change. */
export function computeDiffs(existing: ExistingShowtime, row: CleanRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (existing.status === "archived") diffs.push({ field: "status", oldValue: "archived", newValue: "active" });
  if (existing.startTime.getTime() !== row.startTime.getTime()) {
    diffs.push({ field: "startTime", oldValue: existing.startTime.toISOString(), newValue: row.startTime.toISOString() });
  }
  for (const field of COMPARED_FIELDS) {
    const oldValue = iso(existing[field]);
    const newValue = iso(row[field]);
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue });
  }
  return diffs;
}

/** Fields (by name) in which two file rows differ. */
export function differingFields(a: CleanRow, b: CleanRow): string[] {
  return COMPARED_FIELDS.filter((f) => iso(a[f]) !== iso(b[f]));
}

export const sameNumbers = (a: string, b: string) => digitTokens(a).join(" ") === digitTokens(b).join(" ");

// Words too common to tell two films apart. Kept short on purpose: "into" or "across" are subtitles.
const STOPWORDS = new Set(["the", "and", "for", "from", "with", "part"]);

const significant = (w: string) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w);

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** A typo away: one edit for short words, two for long ones ("homecomming" / "homecoming"). */
const closeWords = (a: string, b: string) => editDistance(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);

/**
 * Is word i of `own` accounted for on the other side? As a close word, or split
 * differently: "spiderman" against "spider man", in either direction.
 */
function covered(own: string[], i: number, other: string[]): boolean {
  const w = own[i]!;
  const near = (x: string) => other.some((o) => closeWords(x, o));
  if (near(w)) return true;
  for (let j = 0; j + 1 < other.length; j++) if (closeWords(w, other[j]! + other[j + 1]!)) return true;
  return (i > 0 && near(own[i - 1]! + w)) || (i + 1 < own.length && near(w + own[i + 1]!));
}

/**
 * Two titles name different films when EACH side has a significant word the other
 * side doesn't account for: "Across the Spider-Verse" / "Into the Spider-Verse",
 * "Dune: Prophecy" / "Dune: Part Two". A word missing on one side only is a
 * shortened or longer form of the same title ("Dune Pt. II" / "Dune: Part Two").
 */
export function titlesConflict(aKey: string, bKey: string): boolean {
  const a = aKey.split(" ").filter(Boolean);
  const b = bKey.split(" ").filter(Boolean);
  const unmatched = (xs: string[], ys: string[]) => xs.some((w, i) => significant(w) && !covered(xs, i, ys));
  return unmatched(a, b) && unmatched(b, a);
}

/**
 * Could these two title keys be the same film? Same numbers (no sequel mix-ups),
 * no conflicting subtitle words, and a trigram similarity of at least `minSimilarity`.
 */
export function similarTitles(aKey: string, bKey: string, minSimilarity = FUZZY_THRESHOLD): boolean {
  if (aKey === bKey) return true;
  if (!sameNumbers(aKey, bKey) || titlesConflict(aKey, bKey)) return false;
  return trigramSimilarity(aKey, bKey) >= minSimilarity;
}

/** Same film at the same start: the test for "this would be a second active copy". */
export function sameShowtime(a: { movieTitleKey: string; startTime: Date }, b: { movieTitleKey: string; startTime: Date }): boolean {
  return a.startTime.getTime() === b.startTime.getTime() && similarTitles(a.movieTitleKey, b.movieTitleKey);
}
