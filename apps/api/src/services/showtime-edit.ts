/**
 * Admin edits to single showtimes. Pure helpers: the router does the I/O.
 * Values go through the same cleaning as CSV imports, so a hand-typed "imax"
 * lands as "IMAX" and match keys stay consistent with what imports compare against.
 */
import { auditoriumKey, cleanText, normalizeFormat, normalizeLanguage, normalizeRating, titleKey } from "../csv";
import type { showtimes } from "../db/schema";

type ShowtimeRecord = typeof showtimes.$inferSelect;
type ShowtimePatch = Partial<typeof showtimes.$inferInsert>;

export interface ShowtimeFieldInput {
  movieTitle?: string;
  auditorium?: string;
  startTime?: string;
  endTime?: string;
  language?: string;
  format?: string;
  rating?: string;
}

export class ShowtimeFieldError extends Error {}

/** Cleans the given fields and fills in the derived match keys. Throws ShowtimeFieldError on bad input. */
export function normalizeShowtimeFields(input: ShowtimeFieldInput): ShowtimePatch {
  const out: ShowtimePatch = {};
  const nonEmpty = (label: string, v: string) => {
    if (!v) throw new ShowtimeFieldError(`${label} is required`);
    return v;
  };
  if (input.movieTitle !== undefined) {
    out.movieTitle = nonEmpty("Title", cleanText(input.movieTitle));
    out.movieTitleKey = nonEmpty("Title", titleKey(out.movieTitle));
  }
  if (input.auditorium !== undefined) {
    out.auditorium = nonEmpty("Auditorium", cleanText(input.auditorium));
    out.auditoriumKey = nonEmpty("Auditorium", auditoriumKey(out.auditorium));
  }
  if (input.language !== undefined) out.language = nonEmpty("Language", normalizeLanguage(input.language).value);
  if (input.format !== undefined) out.format = nonEmpty("Format", normalizeFormat(input.format).value);
  if (input.rating !== undefined) out.rating = nonEmpty("Rating", normalizeRating(input.rating).value);
  if (input.startTime !== undefined) out.startTime = new Date(input.startTime);
  if (input.endTime !== undefined) out.endTime = new Date(input.endTime);
  return out;
}

/** Fields shown in audit entries and compared to decide what changed. */
export const AUDITED_FIELDS = [
  "movieTitle",
  "auditorium",
  "startTime",
  "endTime",
  "language",
  "format",
  "rating",
  "movieStatus",
  "status",
] as const;
type AuditedField = (typeof AUDITED_FIELDS)[number];

const plain = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

/** Only the fields whose value actually changes, as before/after maps for the audit log. */
export function diffShowtime(current: ShowtimeRecord, patch: ShowtimePatch) {
  const before: Partial<Record<AuditedField, unknown>> = {};
  const after: Partial<Record<AuditedField, unknown>> = {};
  for (const f of AUDITED_FIELDS) {
    if (patch[f] === undefined) continue;
    const a = plain(current[f]);
    const b = plain(patch[f]);
    if (a !== b) {
      before[f] = a;
      after[f] = b;
    }
  }
  return { before, after, changed: Object.keys(after) as AuditedField[] };
}

/** Snapshot of a showtime's editable fields, for a create's audit entry. */
export function auditSnapshot(row: ShowtimeRecord) {
  return Object.fromEntries(AUDITED_FIELDS.map((f) => [f, plain(row[f])]));
}

export const DUPLICATE_ACTIVE = "Another active showtime of this film already starts at that time";
