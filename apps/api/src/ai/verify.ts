/**
 * The LLM proposes, this file decides what's allowed.
 *
 * Takes the deterministic reconcile result and the agent's review, and returns
 * the final proposal shown to the reviewer. Every agent decision is checked
 * against the real schedule; anything invalid falls back to the rules' answer
 * and counts as a correction. Diffs are always computed here, never by the model.
 */
import { digitTokens, titleKey, trigramSimilarity } from "../csv/normalize";
import { headerToColumn } from "../csv/parse";
import type { CleanRow, ExistingShowtime, FieldDiff, ReconciledRow, ReconcileResult, RowOutcome } from "../csv/types";

export type AgentAction = "add" | "update" | "unchanged" | "duplicate" | "skip";

export interface AgentRowDecision {
  line: number;
  action: AgentAction;
  showtimeId: string | null;
  duplicateOfLine: number | null;
  confidence: number;
  explanation: string;
}

export interface AgentReview {
  summary: string;
  rows: AgentRowDecision[];
  missing: { showtimeId: string; explanation: string }[];
  /** Lines the agent was asked to decide (and finished). Others are the rules' to decide, not corrections. */
  delegated?: number[];
}

export type FinalMatchMethod = "exact_key" | "fuzzy_title" | "reactivated" | "moved" | "ai_match";

export interface FinalRow extends Omit<ReconciledRow, "matchMethod"> {
  matchMethod: FinalMatchMethod | null;
  explanation: string;
  confidence: number | null;
  decisionSource: "ai" | "rules";
  aiOverrodeRules: boolean;
  duplicateOf: number | null;
  /** Set when a matched row's title differed from the stored one (which is kept). */
  partnerTitle?: string;
}

export interface FinalArchive {
  showtime: ExistingShowtime;
  explanation: string;
  decisionSource: "ai" | "rules";
}

export interface MergeResult {
  rows: FinalRow[];
  archives: FinalArchive[];
  counts: Record<RowOutcome, number> & { archive: number };
  /** Verified agent decisions that differ from the rules' answer. */
  overrides: number;
  /** Agent decisions rejected by verification and replaced with the rules' answer. */
  corrections: number;
}

/** A showtime can move by at most this much and still count as the same showtime. */
export const MAX_MOVE_MS = 3 * 60 * 60 * 1000;
/** Below this title similarity, a same-time match is implausible (different film). */
const MIN_SAME_TIME_SIMILARITY = 0.25;
const FUZZY_THRESHOLD = 0.6;

const COMPARED_FIELDS = ["movieTitle", "auditorium", "endTime", "language", "format", "rating"] as const;
type ComparedField = (typeof COMPARED_FIELDS)[number];

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);

const keyOf = (titleKey: string, start: Date) => `${titleKey}|${start.getTime()}`;

export function computeDiffs(existing: ExistingShowtime, row: CleanRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (existing.status === "archived") diffs.push({ field: "status", oldValue: "archived", newValue: "active" });
  if (existing.startTime.getTime() !== row.startTime.getTime()) {
    diffs.push({ field: "startTime", oldValue: existing.startTime.toISOString(), newValue: row.startTime.toISOString() });
  }
  for (const field of COMPARED_FIELDS) {
    const oldValue = iso(existing[field] as string | Date);
    const newValue = iso(row[field] as string | Date);
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue });
  }
  return diffs;
}

/** Can this file row plausibly be that existing showtime? Code's veto over the model. */
export function plausibleMatch(row: CleanRow, s: ExistingShowtime): { ok: true; method: FinalMatchMethod } | { ok: false; reason: string } {
  // Sequels never match: "Kung Fu Panda 4" is not "Kung Fu Panda 3".
  if (digitTokens(row.movieTitleKey).join(" ") !== digitTokens(s.movieTitleKey).join(" ")) {
    return { ok: false, reason: "different sequel or number in the title" };
  }
  const sameKey = row.movieTitleKey === s.movieTitleKey;
  const similarity = trigramSimilarity(row.movieTitleKey, s.movieTitleKey);
  const delta = Math.abs(row.startTime.getTime() - s.startTime.getTime());
  if (delta === 0) {
    if (!sameKey && similarity < MIN_SAME_TIME_SIMILARITY) return { ok: false, reason: "titles are too different" };
    if (s.status === "archived") return { ok: true, method: "reactivated" };
    return { ok: true, method: sameKey ? "exact_key" : similarity >= FUZZY_THRESHOLD ? "fuzzy_title" : "ai_match" };
  }
  if (s.status === "archived") return { ok: false, reason: "an archived showtime can only come back at its original time" };
  if (delta > MAX_MOVE_MS) return { ok: false, reason: "start time moved by more than 3 hours" };
  if (!sameKey && similarity < FUZZY_THRESHOLD) return { ok: false, reason: "a moved showtime needs a near-identical title" };
  return { ok: true, method: "moved" };
}

function formatLocal(d: Date, timezone: string) {
  return d.toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const fieldNames: Record<string, string> = {
  movieTitle: "title",
  auditorium: "auditorium",
  endTime: "end time",
  startTime: "start time",
  language: "language",
  format: "format",
  rating: "rating",
  status: "status",
};

export function describeDiffs(diffs: FieldDiff[], timezone: string): string {
  const parts = diffs
    .filter((d) => d.field !== "status")
    .map((d) => {
      const show = (v: string) => (d.field.endsWith("Time") ? formatLocal(new Date(v), timezone) : `"${v}"`);
      return `${fieldNames[d.field] ?? d.field} from ${show(d.oldValue)} to ${show(d.newValue)}`;
    });
  return parts.length ? `Changes: ${parts.join("; ")}.` : "";
}

/** Plain-language reason when the rules made the call. */
export function rulesExplanation(row: FinalRow, existingById: Map<string, ExistingShowtime>, timezone: string): string {
  const v = row.value;
  switch (row.outcome) {
    case "rejected":
      return `Not imported: ${row.errors.map((e) => e.message.replace(/\.$/, "")).join("; ") || "the row is invalid"}.`;
    case "duplicate":
      return row.duplicateOf
        ? `Repeats line ${row.duplicateOf} (same film and start time), so it's skipped.`
        : "Repeats an earlier line (same film and start time), so it's skipped.";
    case "add":
      return v
        ? `No showtime of "${v.movieTitle}" at ${formatLocal(v.startTime, timezone)} in the current schedule, so it's added as new.`
        : "Added as a new showtime.";
    case "unchanged":
      return "Already in the schedule exactly as listed. Only the feed's last-updated time is recorded.";
    case "update": {
      const s = row.showtimeId ? existingById.get(row.showtimeId) : undefined;
      const changes = describeDiffs(row.diffs, timezone);
      if (row.matchMethod === "reactivated") return `This showtime was archived and is back in the drop, so it's restored. ${changes}`.trim();
      if (row.matchMethod === "fuzzy_title" && s) return `Matched "${s.movieTitle}" at the same start time by a similar title. ${changes}`.trim();
      if (row.matchMethod === "moved") return `Same film, start time moved. ${changes}`.trim();
      return `Matched on film and start time. ${changes}`.trim();
    }
  }
}

const MISSING_RULES_TEXT = "Not in this drop. Showtimes missing from a new drop are archived.";

/** Same film and start as sent: equal keys, or the same start with a near-identical title and the same numbers. */
function sameShowtime(a: CleanRow | null, b: CleanRow | null): boolean {
  if (!a || !b || a.startTime.getTime() !== b.startTime.getTime()) return false;
  if (a.movieTitleKey === b.movieTitleKey) return true;
  return (
    trigramSimilarity(a.movieTitleKey, b.movieTitleKey) >= FUZZY_THRESHOLD &&
    digitTokens(a.movieTitleKey).join(" ") === digitTokens(b.movieTitleKey).join(" ")
  );
}

/** Text that talks about instructions or operators came from the data, not from judgement. */
const SUSPICIOUS = /\b(instruct\w*|operator|override|as requested|ignore (all|previous)|system prompt)\b/i;

/**
 * Agent reasons are shown next to a code-computed diff, so drop sentences that
 * restate the change ("from X to Y", which models sometimes get backwards) and
 * anything that echoes instructions found in the data.
 */
export function cleanExplanation(text: string, row: FinalRow): string {
  if (!text || SUSPICIOUS.test(text)) return "";
  if (row.diffs.length === 0) return text.trim();
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bfrom\b.+\bto\b/i.test(sentence));
  return kept.join(" ").trim();
}

export function mergeAgentReview(
  det: ReconcileResult,
  review: AgentReview | null,
  existing: ExistingShowtime[],
  opts: { timezone: string },
): MergeResult {
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const byLine = new Map<number, AgentRowDecision>();
  for (const d of review?.rows ?? []) if (!byLine.has(d.line)) byLine.set(d.line, d);

  const claimed = new Set<string>();
  // Keys that will be active after applying (claimed rows + adds), to catch collisions.
  const activeKeys = new Map<string, number>();
  let corrections = 0;

  const rows: FinalRow[] = det.rows.map((r) => ({
    ...r,
    matchMethod: r.matchMethod,
    explanation: "",
    confidence: null,
    decisionSource: "rules",
    aiOverrodeRules: false,
    duplicateOf: null,
  }));
  const lineIndex = new Map(rows.map((r, i) => [r.lineNumber, i]));

  // Duplicate-of for rule duplicates: earliest earlier row with the same key.
  const firstByKey = new Map<string, number>();
  for (const r of rows) {
    if (!r.value) continue;
    const k = keyOf(r.value.movieTitleKey, r.value.startTime);
    if (!firstByKey.has(k)) firstByKey.set(k, r.lineNumber);
    else if (r.outcome === "duplicate") r.duplicateOf = firstByKey.get(k)!;
  }

  const setMatch = (row: FinalRow, s: ExistingShowtime, method: FinalMatchMethod) => {
    claimed.add(s.id);
    row.showtimeId = s.id;
    row.matchMethod = method;
    // A match means "same showtime", so the stored title wins: a partner's
    // spelling ("Spiderman Homecomming") must never overwrite the schedule's.
    if (row.value && row.value.movieTitle !== s.movieTitle) {
      const partnerTitle = row.value.movieTitle;
      row.value = { ...row.value, movieTitle: s.movieTitle, movieTitleKey: s.movieTitleKey };
      if (!row.warnings.some((w) => w.column === "movie_title" && w.message.startsWith("Partner wrote"))) {
        row.warnings = [...row.warnings, { column: "movie_title", message: `Partner wrote "${partnerTitle}"; keeping "${s.movieTitle}".` }];
      }
      row.partnerTitle = partnerTitle;
    }
    row.diffs = computeDiffs(s, row.value!);
    row.outcome = row.diffs.length ? "update" : "unchanged";
    activeKeys.set(keyOf(row.value!.movieTitleKey, row.value!.startTime), row.lineNumber);
  };

  /** The rules' answer for a row, adjusted if an earlier verified decision took its showtime. */
  const applyRules = (row: FinalRow, original: ReconciledRow) => {
    row.decisionSource = "rules";
    row.confidence = null;
    if (!row.value) {
      row.outcome = "rejected";
      return;
    }
    if (original.outcome === "duplicate") {
      row.outcome = "duplicate";
      row.showtimeId = null;
      row.matchMethod = null;
      row.diffs = [];
      return;
    }
    if ((original.outcome === "update" || original.outcome === "unchanged") && original.showtimeId) {
      const s = existingById.get(original.showtimeId);
      if (s && !claimed.has(s.id)) {
        setMatch(row, s, (original.matchMethod as FinalMatchMethod | null) ?? "exact_key");
        return;
      }
    }
    row.outcome = "add";
    row.showtimeId = null;
    row.matchMethod = null;
    row.diffs = [];
  };

  // Pass 1: agent matches (update / unchanged) claim showtimes first, in file order.
  const deferred: { row: FinalRow; original: ReconciledRow; decision: AgentRowDecision | undefined }[] = [];
  rows.forEach((row, i) => {
    const original = det.rows[i]!;
    const d = byLine.get(row.lineNumber);
    if (!row.value) {
      // Parser-rejected rows stay rejected; the agent may only explain them.
      row.outcome = "rejected";
      if (d?.action === "skip" && d.explanation) {
        row.explanation = d.explanation;
        row.decisionSource = "ai";
        row.confidence = d.confidence;
      } else if (d && d.action !== "skip") {
        corrections++;
      }
      return;
    }
    if (d && (d.action === "update" || d.action === "unchanged")) {
      const s = d.showtimeId ? existingById.get(d.showtimeId) : undefined;
      const check = s && !claimed.has(s.id) ? plausibleMatch(row.value, s) : null;
      if (s && check?.ok) {
        setMatch(row, s, check.method);
        row.decisionSource = "ai";
        row.confidence = d.confidence;
        row.explanation = d.explanation;
        return;
      }
      corrections++;
      deferred.push({ row, original, decision: undefined });
      return;
    }
    deferred.push({ row, original, decision: d });
  });

  // Pass 2: everything else (rules fallbacks, adds, duplicates), in file order.
  deferred.sort((a, b) => a.row.lineNumber - b.row.lineNumber);
  for (const { row, original, decision: d } of deferred) {
    if (!d) {
      const delegated = !review?.delegated || review.delegated.includes(row.lineNumber);
      if (!byLine.has(row.lineNumber) && review && delegated) corrections++; // agent skipped a line it owned
      applyRules(row, original);
      continue;
    }
    if (d.action === "duplicate") {
      const targetIdx = d.duplicateOfLine != null ? (lineIndex.get(d.duplicateOfLine) ?? -1) : -1;
      const target = rows[targetIdx];
      // A duplicate must really repeat its target (same film and start), judged on the rows as sent.
      if (target && target.lineNumber < row.lineNumber && target.value && sameShowtime(original.value, det.rows[targetIdx]?.value ?? null)) {
        row.outcome = "duplicate";
        row.showtimeId = null;
        row.matchMethod = null;
        row.diffs = [];
        row.duplicateOf = target.lineNumber;
        row.decisionSource = "ai";
        row.confidence = d.confidence;
        row.explanation = d.explanation;
        continue;
      }
      corrections++;
      applyRules(row, original);
      continue;
    }
    if (d.action === "add") {
      // The agent may not release a showtime the rules matched: that would archive a showtime that is in the drop.
      if ((original.outcome === "update" || original.outcome === "unchanged") && original.showtimeId && !claimed.has(original.showtimeId)) {
        corrections++;
        applyRules(row, original);
        continue;
      }
      const key = keyOf(row.value!.movieTitleKey, row.value!.startTime);
      // An add can't duplicate something that will be active, or an exact showtime that's sitting there unmatched.
      const exactLive = existing.find(
        (s) =>
          s.status !== "archived" &&
          !claimed.has(s.id) &&
          s.movieTitleKey === row.value!.movieTitleKey &&
          s.startTime.getTime() === row.value!.startTime.getTime(),
      );
      if (activeKeys.has(key) || exactLive) {
        corrections++;
        applyRules(row, original);
        if (row.outcome === "add" && activeKeys.has(key)) {
          row.outcome = "duplicate";
          row.duplicateOf = activeKeys.get(key)!;
        }
        if (row.outcome === "add") activeKeys.set(key, row.lineNumber);
        continue;
      }
      row.outcome = "add";
      row.showtimeId = null;
      row.matchMethod = null;
      row.diffs = [];
      row.decisionSource = "ai";
      row.confidence = d.confidence;
      row.explanation = d.explanation;
      activeKeys.set(key, row.lineNumber);
      continue;
    }
    // "skip" on a valid row isn't allowed: only the parser rejects rows.
    corrections++;
    applyRules(row, original);
  }

  // Rules-made adds still can't collide with each other or with active rows.
  for (const row of rows) {
    if (row.outcome !== "add" || row.decisionSource !== "rules" || !row.value) continue;
    const key = keyOf(row.value.movieTitleKey, row.value.startTime);
    const owner = activeKeys.get(key);
    if (owner !== undefined && owner !== row.lineNumber) {
      row.outcome = "duplicate";
      row.duplicateOf = owner;
    } else {
      activeKeys.set(key, row.lineNumber);
    }
  }

  // Overrides and explanations.
  let overrides = 0;
  rows.forEach((row, i) => {
    const original = det.rows[i]!;
    if (row.decisionSource === "ai") {
      const differs = row.outcome !== original.outcome || (row.showtimeId ?? null) !== (original.showtimeId ?? null);
      row.aiOverrodeRules = differs;
      if (differs) overrides++;
    }
    if (row.decisionSource === "ai") row.explanation = cleanExplanation(row.explanation, row);
    if (!row.explanation) row.explanation = rulesExplanation(row, existingById, opts.timezone);
    // A new showtime of a film the theater already lists takes the stored spelling.
    if (row.outcome === "add" && row.value) {
      const known = existing.find((s) => s.movieTitleKey === row.value!.movieTitleKey);
      if (known && known.movieTitle !== row.value.movieTitle) {
        row.warnings = [...row.warnings, { column: "movie_title", message: `Partner wrote "${row.value.movieTitle}"; keeping "${known.movieTitle}".` }];
        row.partnerTitle = row.value.movieTitle;
        row.value = { ...row.value, movieTitle: known.movieTitle };
      }
    }
  });

  // A row that failed validation but still names a showtime (title + start) protects that
  // showtime: a malformed line is not evidence the showtime was dropped.
  const heldByRejected = new Set<string>();
  for (const r of rows) {
    if (r.value) continue;
    let title = "";
    let start = NaN;
    for (const [header, cell] of Object.entries(r.raw)) {
      const col = headerToColumn(header);
      if (col === "movie_title") title = cell;
      if (col === "start_time") start = Date.parse(cell);
    }
    if (!title || Number.isNaN(start)) continue;
    const key = titleKey(title);
    const hit = existing.find(
      (s) => s.status !== "archived" && !claimed.has(s.id) && s.startTime.getTime() === start && (s.movieTitleKey === key || trigramSimilarity(s.movieTitleKey, key) >= FUZZY_THRESHOLD),
    );
    if (hit) {
      heldByRejected.add(hit.id);
      r.warnings = [...r.warnings, { column: "*", message: `Refers to ${hit.movieTitle} at this time, which is left as it is.` }];
    }
  }

  // Archives: computed by code from what nothing claimed. The agent only explains.
  const missingText = new Map((review?.missing ?? []).map((m) => [m.showtimeId, m.explanation]));
  const archives: FinalArchive[] = existing
    .filter((s) => s.status !== "archived" && !claimed.has(s.id) && !heldByRejected.has(s.id))
    .map((s) => {
      const raw = missingText.get(s.id);
      const text = raw && !SUSPICIOUS.test(raw) ? raw : undefined;
      return { showtime: s, explanation: text ?? MISSING_RULES_TEXT, decisionSource: text ? "ai" : "rules" };
    });

  const counts = { add: 0, update: 0, unchanged: 0, duplicate: 0, rejected: 0, archive: archives.length } as MergeResult["counts"];
  for (const r of rows) counts[r.outcome]++;

  return { rows, archives, counts, overrides, corrections };
}
