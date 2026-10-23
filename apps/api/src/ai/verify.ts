/**
 * The LLM proposes, this file decides what's allowed.
 *
 * Takes the deterministic reconcile result and the agent's review, and returns
 * the final proposal shown to the reviewer. Every agent decision is checked
 * against the real schedule; anything invalid falls back to the rules' answer
 * and counts as a correction. Diffs are always computed here, never by the model.
 */
import { computeDiffs, FUZZY_THRESHOLD, keepStoredForAbsent, sameNumbers, sameShowtime, similarTitles, titlesConflict } from "../csv/match";
import { titleKey, trigramSimilarity } from "../csv/normalize";
import { columnCell } from "../csv/parse";
import { parseTimestamp } from "../csv/time";
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
  rows: AgentRowDecision[];
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
/**
 * The agent may match a same-start title a little below the rules' threshold
 * (abbreviations like "Dune Pt. II" for "Dune: Part Two" score 0.57), never an unrelated one.
 */
const AI_MIN_SIMILARITY = 0.5;

/** Can this file row plausibly be that existing showtime? Code's veto over the model. */
export function plausibleMatch(row: CleanRow, s: ExistingShowtime): { ok: true; method: FinalMatchMethod } | { ok: false; reason: string } {
  const sameKey = row.movieTitleKey === s.movieTitleKey;
  // Sequels never match: "Kung Fu Panda 4" is not "Kung Fu Panda 3".
  if (!sameKey && !sameNumbers(row.movieTitleKey, s.movieTitleKey)) return { ok: false, reason: "different sequel or number in the title" };
  // "Across the Spider-Verse" is not "Into the Spider-Verse".
  if (!sameKey && titlesConflict(row.movieTitleKey, s.movieTitleKey)) return { ok: false, reason: "the titles name different films" };
  const similarity = trigramSimilarity(row.movieTitleKey, s.movieTitleKey);
  const delta = Math.abs(row.startTime.getTime() - s.startTime.getTime());
  if (delta === 0) {
    if (!sameKey && similarity < AI_MIN_SIMILARITY) return { ok: false, reason: "titles are too different" };
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

/** Plain-language reason when the rules made the call. */
export function rulesExplanation(row: FinalRow, existingById: Map<string, ExistingShowtime>, timezone: string): string {
  const v = row.value;
  switch (row.outcome) {
    case "rejected":
      return rejectionReason(row.errors);
    case "duplicate":
      return row.duplicateOf
        ? `Repeats line ${row.duplicateOf} (same film and start time), so it's skipped.`
        : "Repeats an earlier line (same film and start time), so it's skipped.";
    case "add":
      return v
        ? `Nothing in the schedule matches this film at ${formatLocal(v.startTime, timezone)}, so it's added as new.`
        : "Added as a new showtime.";
    case "unchanged":
      return row.partnerTitle
        ? `Already in the schedule; the drop spells the title "${row.partnerTitle}" and the stored title is kept.`
        : "Already in the schedule exactly as listed. Only the feed's last-updated time is recorded.";
    case "update": {
      // The screen already shows the change itself; this says why it's the same showtime.
      const s = row.showtimeId ? existingById.get(row.showtimeId) : undefined;
      if (row.matchMethod === "reactivated") return "This showtime was archived and is back in the drop, so it's restored.";
      if (row.matchMethod === "fuzzy_title" && s) return `Same start time and a near-identical title to "${s.movieTitle}".`;
      if (row.matchMethod === "moved") return "Same film in the same theater, a short time from the stored start, so it's treated as moved.";
      return "Same film and start time as the stored showtime.";
    }
  }
}

const columnNames: Record<string, string> = {
  theater_name: "theater name",
  movie_title: "film title",
  auditorium: "auditorium",
  start_time: "start time",
  end_time: "end time",
  language: "language",
  format: "format",
  rating: "rating",
  last_updated: "last-updated time",
};

/** One validation issue in plain words, e.g. "missing start time". */
function plainIssue(issue: { column: string; message: string }): string {
  const name = columnNames[issue.column] ?? "a column";
  const msg = issue.message.replace(/\.$/, "");
  if (msg === "Required") return `missing ${name}`;
  const theater = /^Row is for theater "(.+)", not "(.+)"$/.exec(msg);
  if (theater) return `the row is for ${theater[1]}, not ${theater[2]}`;
  if (issue.column === "end_time" && msg.startsWith("Ends before")) return "the end time is at or before the start time";
  const cells = /^Row has (\d+) cells but the header has (\d+)/.exec(msg);
  if (cells) return `the row has ${cells[1]} columns but the header has ${cells[2]}`;
  if (msg.startsWith("Longer than")) return `the ${name} is ${msg.toLowerCase()}`;
  if (/^(Invalid|Unrecognized) (date|time)|has a date but no time|does not exist in/.test(msg)) return `the ${name} can't be read (${msg})`;
  return msg.charAt(0).toLowerCase() + msg.slice(1);
}

/** Why a row wasn't imported, written by code from the validation issues. */
export function rejectionReason(errors: { column: string; message: string }[]): string {
  const parts = [...new Set(errors.map(plainIssue))];
  const text = parts.join("; ") || "the row is invalid";
  return `Not imported: ${text}.`;
}

const MISSING_TEXT = "Not in this drop. Showtimes missing from a new drop are archived.";

/** Text that gives orders came from the data, not from judgement. */
const INSTRUCTION_LIKE = /\b(ignore|disregard|instruct\w*|system prompt|override|as requested|you (must|should))\b/i;
/** Claims the drop wrote the title or auditorium exactly as stored. */
const CLAIMS_EXACT = /\b(identical|exact(ly)?|verbatim|word[- ]for[- ]word|same (title|name|spelling|wording))\b/i;
const MAX_REASON = 200;

/**
 * The agent's reason is shown as written only if it passes simple checks: not empty,
 * short, no instruction-like text, and no "identical"/"exact" claim when the drop's
 * raw title or auditorium differs from what's stored. Otherwise code writes the reason.
 */
export function acceptableReason(text: string, sent: CleanRow | null, stored: ExistingShowtime | undefined): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_REASON || INSTRUCTION_LIKE.test(t)) return false;
  const textDiffers = !!sent && !!stored && (sent.movieTitle !== stored.movieTitle || sent.auditorium !== stored.auditorium);
  if (textDiffers && CLAIMS_EXACT.test(t)) return false;
  // The screen already shows the change and the drop's spelling; a reason that repeats them adds nothing.
  const repeats = (raw: string | undefined, kept: string | undefined) => !!raw && raw !== kept && t.includes(raw);
  if (repeats(sent?.movieTitle, stored?.movieTitle) || repeats(sent?.auditorium, stored?.auditorium)) return false;
  return !RESTATES_CHANGE.test(t);
}

/** "moved from 10:30 AM to 10:45 AM", "from Aud 1 to Aud. 1": the change, not a reason. */
const RESTATES_CHANGE = /\bfrom\b[^.]*\bto\b/i;

/** Was this line the agent's to decide? (Every line, when the review doesn't say.) */
const ownedBy = (review: AgentReview | null, row: FinalRow) => !!review && (!review.delegated || review.delegated.includes(row.lineNumber));

/** Shared state for the merge steps below. */
interface MergeState {
  det: ReconcileResult;
  rows: FinalRow[];
  existing: ExistingShowtime[];
  existingById: Map<string, ExistingShowtime>;
  byLine: Map<number, AgentRowDecision>;
  claimed: Set<string>;
  /** Rows already decided by an earlier step. */
  settled: Set<FinalRow>;
  /** Matched rows whose title key differs from the stored one: shown for review, never a silent "unchanged". */
  titleKeyDiffers: Set<FinalRow>;
  corrections: number;
}

function setMatch(st: MergeState, row: FinalRow, s: ExistingShowtime, method: FinalMatchMethod) {
  st.claimed.add(s.id);
  row.showtimeId = s.id;
  row.matchMethod = method;
  row.duplicateOf = null;
  const keyDiffers = row.value!.movieTitleKey !== s.movieTitleKey;
  if (keyDiffers) st.titleKeyDiffers.add(row);
  else st.titleKeyDiffers.delete(row);
  // A match means "same showtime", so the stored title wins: a partner's
  // spelling ("Spiderman Homecomming") must never overwrite the schedule's.
  if (row.value!.movieTitle !== s.movieTitle) {
    row.partnerTitle = row.value!.movieTitle;
    row.value = { ...row.value!, movieTitle: s.movieTitle, movieTitleKey: s.movieTitleKey };
  }
  // Columns the file doesn't have keep their stored values when applied.
  row.value = keepStoredForAbsent(row.value!, s);
  row.diffs = computeDiffs(s, row.value);
  row.outcome = row.diffs.length > 0 || keyDiffers ? "update" : "unchanged";
}

function fromAgent(row: FinalRow, d: AgentRowDecision) {
  row.decisionSource = "ai";
  row.confidence = d.confidence;
  row.explanation = d.explanation;
}

function setDuplicate(row: FinalRow, of: number) {
  row.outcome = "duplicate";
  row.showtimeId = null;
  row.matchMethod = null;
  row.diffs = [];
  row.duplicateOf = of;
}

function setAdd(row: FinalRow) {
  row.outcome = "add";
  row.showtimeId = null;
  row.matchMethod = null;
  row.diffs = [];
  row.duplicateOf = null;
}

/** The rules' answer for a row, adjusted if an earlier verified decision took its showtime. */
function applyRules(st: MergeState, row: FinalRow, original: ReconciledRow) {
  row.decisionSource = "rules";
  row.confidence = null;
  row.explanation = "";
  if (!row.value) {
    row.outcome = "rejected";
    return;
  }
  if (original.outcome === "duplicate" && original.duplicateOf != null) return setDuplicate(row, original.duplicateOf);
  const s = original.showtimeId ? st.existingById.get(original.showtimeId) : undefined;
  if (s && !st.claimed.has(s.id)) return setMatch(st, row, s, original.matchMethod ?? "exact_key");
  setAdd(row);
}

/**
 * Step 1. A rules match with the same title key at the same start is identity, not
 * judgement: it claims its showtime before any agent match, across the whole file.
 */
function lockIdentityMatches(st: MergeState, review: AgentReview | null) {
  st.rows.forEach((row, i) => {
    const original = st.det.rows[i]!;
    const s = original.showtimeId ? st.existingById.get(original.showtimeId) : undefined;
    if (!row.value || !s || s.movieTitleKey !== row.value.movieTitleKey || st.claimed.has(s.id)) return;
    setMatch(st, row, s, original.matchMethod ?? "exact_key");
    st.settled.add(row);
    const d = st.byLine.get(row.lineNumber);
    if (d && (d.action === "update" || d.action === "unchanged") && d.showtimeId === s.id) fromAgent(row, d);
    else if (d || ownedBy(review, row)) st.corrections++; // disagreed with an identity match, or skipped a line it owned
  });
}

/** Step 2. Agent matches (update / unchanged), in file order, each checked by plausibleMatch. */
function acceptAgentMatches(st: MergeState) {
  for (const row of st.rows) {
    const d = st.byLine.get(row.lineNumber);
    if (st.settled.has(row) || !row.value || !d || (d.action !== "update" && d.action !== "unchanged")) continue;
    const s = d.showtimeId ? st.existingById.get(d.showtimeId) : undefined;
    const check = s && !st.claimed.has(s.id) ? plausibleMatch(row.value, s) : null;
    // A loose title match loses to a showtime of exactly this film at this start that nothing matched.
    const exactTwinFree =
      check?.ok && check.method !== "exact_key" &&
      st.existing.some(
        (x) => x.status !== "archived" && !st.claimed.has(x.id) && x.movieTitleKey === row.value!.movieTitleKey && x.startTime.getTime() === row.value!.startTime.getTime(),
      );
    if (s && check?.ok && !exactTwinFree) {
      setMatch(st, row, s, check.method);
      fromAgent(row, d);
      st.settled.add(row);
    } else {
      st.corrections++;
    }
  }
}

/** Step 3. Everything else, in file order: agent adds and duplicates if they hold up, else the rules. */
function decideRest(st: MergeState, review: AgentReview | null) {
  st.rows.forEach((row, i) => {
    if (st.settled.has(row)) return;
    const original = st.det.rows[i]!;
    const d = st.byLine.get(row.lineNumber);
    if (!row.value) {
      // Parser-rejected rows stay rejected, and code writes their reason from the validation issues.
      row.outcome = "rejected";
      if (d && d.action !== "skip") st.corrections++;
      return;
    }
    if (!d) {
      if (ownedBy(review, row)) st.corrections++; // the agent skipped a line it owned
      return applyRules(st, row, original);
    }
    if (d.action === "duplicate") {
      const targetIdx = st.rows.findIndex((r) => r.lineNumber === d.duplicateOfLine);
      const target = st.det.rows[targetIdx];
      // A duplicate must really repeat an earlier row (same film and start), judged on the rows as sent.
      // …and the target can't itself be a duplicate (the rules may have kept a later line instead).
      const targetKept = st.rows[targetIdx]?.outcome !== "duplicate";
      if (target?.value && targetKept && target.lineNumber < row.lineNumber && sameShowtime(original.value!, target.value)) {
        setDuplicate(row, target.lineNumber);
        return fromAgent(row, d);
      }
    }
    if (d.action === "add") {
      // The agent may not release a showtime the rules matched: that would archive a showtime that is in the drop.
      const ruleMatch = original.showtimeId && !st.claimed.has(original.showtimeId);
      if (!ruleMatch) {
        setAdd(row);
        return fromAgent(row, d);
      }
    }
    // update/unchanged were already counted in step 2; anything else that got here failed a check.
    if (d.action !== "update" && d.action !== "unchanged") st.corrections++;
    applyRules(st, row, original);
  });
}

/**
 * Step 4. No add may become a second active copy of a film at the same start: an add
 * that is the same showtime as a matched row or an earlier add becomes its duplicate,
 * and one that is the same as a single unmatched live showtime is matched to it.
 */
function resolveAddCollisions(st: MergeState) {
  // sameShowtime needs an identical start, so bucket by start time: each check looks at a handful of rows, not the file.
  const at = (d: Date) => d.getTime();
  const sentOf = new Map(st.rows.map((r, i) => [r, st.det.rows[i]!.value]));
  const activeAt = new Map<number, FinalRow[]>();
  const addActive = (r: FinalRow) => {
    for (const v of [r.value!, sentOf.get(r)]) {
      if (!v) continue;
      const list = activeAt.get(at(v.startTime)) ?? [];
      if (!list.includes(r)) list.push(r);
      activeAt.set(at(v.startTime), list);
    }
  };
  const liveAt = new Map<number, ExistingShowtime[]>();
  for (const s of st.existing) {
    if (s.status === "archived") continue;
    liveAt.set(at(s.startTime), [...(liveAt.get(at(s.startTime)) ?? []), s]);
  }
  const covers = (owner: FinalRow, row: FinalRow) => {
    const sent = sentOf.get(owner);
    return sameShowtime(owner.value!, row.value!) || (!!sent && sameShowtime(sent, row.value!));
  };

  for (const r of st.rows) if (r.value && (r.outcome === "update" || r.outcome === "unchanged")) addActive(r);
  for (const row of st.rows) {
    if (row.outcome !== "add" || !row.value) continue;
    const wasAgent = row.decisionSource === "ai";
    const owner = (activeAt.get(at(row.value.startTime)) ?? []).find((a) => a !== row && covers(a, row));
    if (owner) {
      setDuplicate(row, owner.lineNumber);
    } else {
      const twins = (liveAt.get(at(row.value.startTime)) ?? []).filter(
        (s) => !st.claimed.has(s.id) && sameShowtime(s, row.value!),
      );
      if (twins.length !== 1) {
        addActive(row);
        continue;
      }
      setMatch(st, row, twins[0]!, twins[0]!.movieTitleKey === row.value.movieTitleKey ? "exact_key" : "fuzzy_title");
      addActive(row);
    }
    if (wasAgent) st.corrections++;
    row.decisionSource = "rules";
    row.confidence = null;
    row.explanation = "";
  }
}

/** Step 5. Reasons: the agent's if it passes acceptableReason, else code's. Counts overrides. */
function writeExplanations(st: MergeState, timezone: string): number {
  let overrides = 0;
  st.rows.forEach((row, i) => {
    const original = st.det.rows[i]!;
    const stored = row.showtimeId ? st.existingById.get(row.showtimeId) : undefined;
    if (row.decisionSource === "ai") {
      row.aiOverrodeRules = row.outcome !== original.outcome || (row.showtimeId ?? null) !== (original.showtimeId ?? null);
      if (row.aiOverrodeRules) overrides++;
      // Models sometimes over-escape quotes inside the JSON string (\"Aud 1\").
      row.explanation = row.explanation.replace(/\\(["'])/g, "$1");
      if (!acceptableReason(row.explanation, original.value, stored)) row.explanation = "";
    }
    row.explanation = row.explanation.trim() || rulesExplanation(row, st.existingById, timezone);
    // A new showtime of a film the theater already lists takes the stored spelling.
    if (row.outcome === "add" && row.value) {
      const known = st.existing.find((s) => s.movieTitleKey === row.value!.movieTitleKey);
      if (known && known.movieTitle !== row.value.movieTitle) {
        row.partnerTitle = row.value.movieTitle;
        row.value = { ...row.value, movieTitle: known.movieTitle };
      }
    }
  });
  return overrides;
}

/**
 * Step 6. A row that failed validation but still names a film here protects showtimes it
 * could refer to: a malformed line is not evidence the showtime was dropped. With a readable
 * start it protects that one showtime (same film and start); without one, every live showtime
 * of that film. Rows for another theater protect nothing.
 */
function heldByRejectedRows(st: MergeState, timezone: string): Set<string> {
  const held = new Set<string>();
  const free = (s: ExistingShowtime) => s.status !== "archived" && !st.claimed.has(s.id) && !held.has(s.id);
  for (const r of st.rows) {
    if (r.value || r.errors.some((e) => e.column === "theater_name")) continue;
    const title = columnCell(r.raw, "movie_title");
    const key = title ? titleKey(title) : "";
    if (!key) continue;
    const start = parseTimestamp(columnCell(r.raw, "start_time") ?? "", timezone);
    if (start.ok) {
      const wanted = { movieTitleKey: key, startTime: start.date };
      const hit = st.existing.find((s) => free(s) && sameShowtime(s, wanted));
      if (hit) {
        held.add(hit.id);
        r.warnings = [...r.warnings, { column: "*", message: `Refers to ${hit.movieTitle} at this time, which is left as it is.` }];
      }
      continue;
    }
    const hits = st.existing.filter((s) => free(s) && similarTitles(key, s.movieTitleKey));
    for (const s of hits) held.add(s.id);
    if (hits.length) {
      const n = hits.length;
      r.warnings = [
        ...r.warnings,
        {
          column: "*",
          message: `Its start time can't be read, so ${n === 1 ? "the stored showtime" : `all ${n} stored showtimes`} of ${hits[0]!.movieTitle} ${n === 1 ? "is" : "are"} left as ${n === 1 ? "it is" : "they are"}.`,
        },
      ];
    }
  }
  return held;
}

/**
 * Turns the rules' result and the agent's review into the proposal the reviewer sees.
 * Order matters: identity matches claim first, then verified agent matches, then
 * everything else; adds are checked for collisions last.
 */
export function mergeAgentReview(
  det: ReconcileResult,
  review: AgentReview | null,
  existing: ExistingShowtime[],
  opts: { timezone: string },
): MergeResult {
  const byLine = new Map<number, AgentRowDecision>();
  for (const d of review?.rows ?? []) if (!byLine.has(d.line)) byLine.set(d.line, d);
  const st: MergeState = {
    det,
    rows: det.rows.map((r) => ({
      ...r,
      explanation: "",
      confidence: null,
      decisionSource: "rules",
      aiOverrodeRules: false,
    })),
    existing,
    existingById: new Map(existing.map((s) => [s.id, s])),
    byLine,
    claimed: new Set(),
    settled: new Set(),
    titleKeyDiffers: new Set(),
    corrections: 0,
  };

  lockIdentityMatches(st, review);
  acceptAgentMatches(st);
  decideRest(st, review);
  resolveAddCollisions(st);
  const overrides = writeExplanations(st, opts.timezone);
  const held = heldByRejectedRows(st, opts.timezone);

  // Archives: computed by code from what nothing claimed, with a code-written reason.
  const archives: FinalArchive[] = existing
    .filter((s) => s.status !== "archived" && !st.claimed.has(s.id) && !held.has(s.id))
    .map((s) => ({ showtime: s, explanation: MISSING_TEXT, decisionSource: "rules" }));

  const counts = { add: 0, update: 0, unchanged: 0, duplicate: 0, rejected: 0, archive: archives.length } as MergeResult["counts"];
  for (const r of st.rows) counts[r.outcome]++;

  return { rows: st.rows, archives, counts, overrides, corrections: st.corrections };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One summary of the drop, written by code from the verified result, so it never contradicts the rows. */
export function summarizeMerge(m: MergeResult, agentRan: boolean): string {
  const c = m.counts;
  const parts = [
    c.add && plural(c.add, "new showtime"),
    c.update && plural(c.update, "update"),
    c.unchanged && `${c.unchanged} unchanged`,
    c.archive && `${c.archive} to archive`,
    c.duplicate && plural(c.duplicate, "duplicate row"),
    c.rejected && plural(c.rejected, "row") + " not imported",
  ].filter(Boolean) as string[];
  const counts = parts.length ? `${parts.join(", ")}.` : "No changes.";
  if (!agentRan) return counts;
  const notes = [
    m.overrides ? `the agent changed ${plural(m.overrides, "call")} the rules made` : null,
    m.corrections ? `${plural(m.corrections, "agent decision")} failed the checks and used the rules' answer` : null,
  ].filter(Boolean) as string[];
  return notes.length ? `${counts} ${notes.join("; ").replace(/^./, (x) => x.toUpperCase())}.` : counts;
}
