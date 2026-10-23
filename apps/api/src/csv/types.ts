export interface RowIssue {
  column: string;
  message: string;
}

export interface FieldDiff {
  field: string;
  oldValue: string;
  newValue: string;
}

/** Optional columns a file may leave out. Their values then come from defaults (adds) or the stored showtime (matches). */
export type OptionalField = "language" | "format" | "rating";

/** One cleaned, validated CSV row. */
export interface CleanRow {
  theaterName: string;
  movieTitle: string;
  movieTitleKey: string;
  auditorium: string;
  auditoriumKey: string;
  startTime: Date;
  endTime: Date;
  language: string;
  format: string;
  rating: string;
  lastUpdated: Date | null;
  /** Optional columns the file doesn't have. These fields hold defaults and are never diffed. */
  absentFields?: OptionalField[];
}

export interface ParsedRow {
  /** 1-based physical line in the file (the header is its own line). */
  lineNumber: number;
  /** Cell values exactly as sent, keyed by the file's own header names. */
  raw: Record<string, string>;
  /** Null when the row has errors. */
  value: CleanRow | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface ParsedFile {
  /** File-level notes for the preview header (encoding, delimiter, ignored columns...). */
  notices: string[];
  headerLine: number;
  rows: ParsedRow[];
}

export type ShowtimeStatus = "active" | "inactive" | "archived";

/** A showtime already in the database, as the reconciler needs it. */
export interface ExistingShowtime {
  id: string;
  movieTitle: string;
  movieTitleKey: string;
  auditorium: string;
  startTime: Date;
  endTime: Date;
  language: string;
  format: string;
  rating: string;
  status: ShowtimeStatus;
  sourceUpdatedAt: Date | null;
}

export type RowOutcome = "add" | "update" | "unchanged" | "duplicate" | "rejected";
export type MatchMethod = "exact_key" | "fuzzy_title" | "reactivated";

export interface ReconciledRow extends ParsedRow {
  outcome: RowOutcome;
  showtimeId: string | null;
  matchMethod: MatchMethod | null;
  diffs: FieldDiff[];
  /** For duplicates: the line that is kept instead. */
  duplicateOf: number | null;
}

export interface ReconcileResult {
  rows: ReconciledRow[];
  /** Non-archived showtimes no row matched. The README says these get archived. */
  archives: ExistingShowtime[];
  counts: Record<RowOutcome, number> & { archive: number };
}
