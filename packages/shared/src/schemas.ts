/**
 * API contract. Every tRPC procedure's input and output is one of these, and
 * the OpenAPI spec is generated from them. The web app imports the same
 * schemas for its forms and uses the inferred types everywhere.
 */
import { z } from "zod";
import {
  ImportRowOutcome,
  ImportStatus,
  MovieStatus,
  ShowtimeStatus,
  TheaterRole,
  UserStatus,
} from "./enums";

const id = z.string().min(1).max(64);
const isoDate = z.iso.datetime({ offset: true });

/* ───────── auth / me ───────── */

export const LoginInput = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const Membership = z.object({
  theaterId: id,
  theaterName: z.string(),
  role: TheaterRole,
});
export type Membership = z.infer<typeof Membership>;

export const Me = z.object({
  id,
  name: z.string(),
  email: z.string(),
  isSuperAdmin: z.boolean(),
  /** Effective roles (a super admin is "admin" everywhere). */
  theaterRoles: z.record(z.string(), TheaterRole),
  permissions: z.array(z.string()),
});
export type Me = z.infer<typeof Me>;

export const DevAccount = z.object({
  email: z.string(),
  name: z.string(),
  summary: z.string(),
});

/* ───────── theaters ───────── */

export const Theater = z.object({
  id,
  name: z.string(),
  location: z.string(),
  timezone: z.string(),
  myRole: TheaterRole,
});
export type Theater = z.infer<typeof Theater>;

const ianaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA timezone");

export const TheaterCreateInput = z.object({
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  timezone: ianaTimezone,
});
export const TheaterUpdateInput = TheaterCreateInput.partial().extend({ id });
export const IdInput = z.object({ id });

/* ───────── showtimes ───────── */

const showtimeBase = {
  id,
  theaterId: id,
  theaterName: z.string(),
  movieTitle: z.string(),
  auditorium: z.string(),
  startTime: isoDate,
  endTime: isoDate,
  language: z.string(),
  format: z.string(),
  rating: z.string(),
};

/** What a viewer may see. */
export const ShowtimeViewerRow = z.object({ access: z.literal("viewer"), ...showtimeBase });
/** What an admin of that theater sees. */
export const ShowtimeAdminRow = z.object({
  access: z.literal("admin"),
  ...showtimeBase,
  movieStatus: MovieStatus,
  status: ShowtimeStatus,
  lastUpdated: isoDate,
  version: z.number().int(),
});
export const ShowtimeRow = z.discriminatedUnion("access", [ShowtimeViewerRow, ShowtimeAdminRow]);
export type ShowtimeRow = z.infer<typeof ShowtimeRow>;
export type ShowtimeAdminRow = z.infer<typeof ShowtimeAdminRow>;

export const SHOWTIME_SORTS = [
  "startTime",
  "endTime",
  "movieTitle",
  "theaterName",
  "lastUpdated",
  "movieStatus",
] as const;
export const ShowtimeSort = z.enum(SHOWTIME_SORTS);
export type ShowtimeSort = z.infer<typeof ShowtimeSort>;
/** Sorting by these needs admin access to every theater in scope (they are hidden from viewers). */
export const ADMIN_ONLY_SORTS: readonly ShowtimeSort[] = ["lastUpdated", "movieStatus"];

const optionalText = z.string().trim().max(100).optional();

export const ShowtimeListInput = z.object({
  theaterId: id.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum([...ShowtimeStatus.options, "all"]).default("all"),
  movieStatus: MovieStatus.optional(),
  format: optionalText,
  language: optionalText,
  rating: optionalText,
  auditorium: optionalText,
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: ShowtimeSort.default("startTime"),
  order: z.enum(["asc", "desc"]).default("asc"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ShowtimeListInput = z.input<typeof ShowtimeListInput>;

export const ShowtimeListOutput = z.object({
  items: z.array(ShowtimeRow),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
  totalCapped: z.boolean(),
});

export const ShowtimeFacetsInput = z.object({ theaterId: id.optional() });
export const ShowtimeFacets = z.object({
  formats: z.array(z.string()),
  languages: z.array(z.string()),
  ratings: z.array(z.string()),
  auditoriums: z.array(z.string()),
  /** Empty unless the caller is admin of at least one theater in scope. */
  movieStatuses: z.array(MovieStatus),
  canSeeInternal: z.boolean(),
});

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is longer than ${max} characters`);

/** Fields an admin can write on a showtime. Times are ISO 8601 with an offset (or Z). */
export const showtimeFields = {
  movieTitle: requiredText("Title", 200),
  auditorium: requiredText("Auditorium", 100),
  startTime: isoDate,
  endTime: isoDate,
  language: requiredText("Language", 40),
  format: requiredText("Format", 40),
  rating: requiredText("Rating", 20),
};

export const END_BEFORE_START = "End time must be after start time";
/** True unless both times are given and the end isn't after the start. */
export const endsAfterStart = (v: { startTime?: string; endTime?: string }) =>
  !v.startTime || !v.endTime || new Date(v.endTime).getTime() > new Date(v.startTime).getTime();

export const ShowtimeCreateInput = z
  .object({
    theaterId: id,
    ...showtimeFields,
    movieStatus: MovieStatus.default("needs-review"),
    status: ShowtimeStatus.default("active"),
  })
  .refine(endsAfterStart, { message: END_BEFORE_START, path: ["endTime"] });
export type ShowtimeCreateInput = z.input<typeof ShowtimeCreateInput>;

const EDITABLE_KEYS = [
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

export const ShowtimeUpdateInput = z
  .object({
    id,
    expectedVersion: z.number().int().positive(),
    movieTitle: showtimeFields.movieTitle.optional(),
    auditorium: showtimeFields.auditorium.optional(),
    startTime: showtimeFields.startTime.optional(),
    endTime: showtimeFields.endTime.optional(),
    language: showtimeFields.language.optional(),
    format: showtimeFields.format.optional(),
    rating: showtimeFields.rating.optional(),
    movieStatus: MovieStatus.optional(),
    status: ShowtimeStatus.optional(),
  })
  .refine((v) => EDITABLE_KEYS.some((k) => v[k] !== undefined), "Nothing to update")
  .refine(endsAfterStart, { message: END_BEFORE_START, path: ["endTime"] });
export type ShowtimeUpdateInput = z.input<typeof ShowtimeUpdateInput>;

export const ArchiveAllInput = z.object({ theaterId: id });
export const ArchiveAllOutput = z.object({ archived: z.number().int() });

/* ───────── imports ───────── */

/** Vercel caps request bodies at 4.5 MB; base64 adds a third, so 3 MB of CSV is the safe ceiling. */
export const MAX_CSV_BYTES = 3 * 1024 * 1024;

export const ImportCreateInput = z.object({
  theaterId: id,
  filename: z.string().trim().min(1).max(255),
  /**
   * Raw file bytes, base64. Sent as bytes (not text) so the server can detect
   * the encoding; a browser would silently mangle Windows-1252 files.
   */
  contentBase64: z
    .string()
    .max(Math.ceil((MAX_CSV_BYTES * 4) / 3) + 4, "File is larger than 3 MB")
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Not base64"),
});

export const FieldDiff = z.object({ field: z.string(), oldValue: z.string(), newValue: z.string() });
export const RowIssue = z.object({ column: z.string(), message: z.string() });

/** Who made a row's final call: the LLM agent (verified by code) or the deterministic rules. */
export const DecisionSource = z.enum(["ai", "rules"]);
export type DecisionSource = z.infer<typeof DecisionSource>;

export const ImportRowView = z.object({
  lineNumber: z.number().int(),
  outcome: ImportRowOutcome,
  showtimeId: z.string().nullable(),
  matchMethod: z.string().nullable(),
  /** Plain-language reason for the proposed action (from the agent, or the rules fallback). */
  explanation: z.string().nullable(),
  /** 0..1, null when the rules decided. */
  confidence: z.number().min(0).max(1).nullable(),
  decisionSource: DecisionSource,
  /** True when the agent's call differs from what the deterministic rules alone would do. */
  aiOverrodeRules: z.boolean(),
  /** For duplicates: the line this row repeats. */
  duplicateOf: z.number().int().nullable(),
  /** The reviewer's choice. Only accepted add/update rows are applied. */
  accepted: z.boolean(),
  movieTitle: z.string().nullable(),
  auditorium: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  diffs: z.array(FieldDiff),
  errors: z.array(RowIssue),
  warnings: z.array(RowIssue),
  raw: z.record(z.string(), z.string()),
});
export type ImportRowView = z.infer<typeof ImportRowView>;

export const ImportArchiveView = z.object({
  showtimeId: z.string(),
  movieTitle: z.string(),
  auditorium: z.string(),
  startTime: isoDate,
  endTime: isoDate,
  explanation: z.string().nullable(),
  decisionSource: DecisionSource,
  /** The reviewer's choice. Unchecked archives leave the showtime as it is. */
  accepted: z.boolean(),
});
export type ImportArchiveView = z.infer<typeof ImportArchiveView>;

export const AgentTraceStep = z.object({
  /** "search" = the agent queried the schedule; "submit" = it handed in its review; "note" = system note. */
  kind: z.enum(["search", "submit", "note"]),
  label: z.string(),
  detail: z.string().nullable(),
});
export type AgentTraceStep = z.infer<typeof AgentTraceStep>;

export const AgentRun = z.object({
  /** ok: agent decided (verified). fallback: agent failed or was unavailable, rules decided. off: no model configured. */
  status: z.enum(["ok", "fallback", "off"]),
  model: z.string().nullable(),
  /** The agent's own 1-3 sentence summary of the drop. */
  summary: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  /** Decisions the agent made that the rules alone would not have. */
  overrides: z.number().int(),
  /** Agent decisions the verifier rejected and replaced with the rules' answer. */
  corrections: z.number().int(),
  trace: z.array(AgentTraceStep),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const ImportSummary = z.object({
  id,
  theaterId: id,
  theaterName: z.string(),
  filename: z.string(),
  status: ImportStatus,
  uploadedBy: z.string(),
  createdAt: isoDate,
  appliedAt: isoDate.nullable(),
  expiresAt: isoDate,
  totalRows: z.number().int(),
  addCount: z.number().int(),
  updateCount: z.number().int(),
  unchangedCount: z.number().int(),
  archiveCount: z.number().int(),
  duplicateCount: z.number().int(),
  rejectedCount: z.number().int(),
  /** File-level notes: encoding fallback, delimiter, ignored columns, large archive, same file as before. */
  notices: z.array(z.string()),
  activeBefore: z.number().int(),
  agent: AgentRun,
});
export type ImportSummary = z.infer<typeof ImportSummary>;

export const ImportDetail = z.object({
  summary: ImportSummary,
  rows: z.array(ImportRowView),
  archives: z.array(ImportArchiveView),
});
export type ImportDetail = z.infer<typeof ImportDetail>;

export const ImportListInput = z.object({ theaterId: id });
export const ImportApplyInput = z.object({
  id,
  /** Required when the import archives more than half of the active schedule. */
  confirmLargeArchive: z.boolean().default(false),
  /**
   * The reviewer's per-action choices. Omitted entries keep the proposal's default (accepted).
   * Only add/update rows and archive proposals can be toggled.
   */
  decisions: z
    .object({
      rows: z.array(z.object({ lineNumber: z.number().int().positive(), accepted: z.boolean() })).max(200_000),
      archives: z.array(z.object({ showtimeId: id, accepted: z.boolean() })).max(200_000),
    })
    .default({ rows: [], archives: [] }),
});

export const DemoResetOutput = z.object({ showtimes: z.number().int(), imports: z.number().int() });

/* ───────── users & memberships ───────── */

export const UserView = z.object({
  id,
  name: z.string(),
  email: z.string(),
  isSuperAdmin: z.boolean(),
  status: UserStatus,
  memberships: z.array(Membership),
  createdAt: isoDate,
});
export type UserView = z.infer<typeof UserView>;

export const UserListInput = z.object({ theaterId: id.optional() });

export const PASSWORD_MIN = 12;
export const Password = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
  .max(200);

export const UserCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  isSuperAdmin: z.boolean().default(false),
  memberships: z
    .array(z.object({ theaterId: id, role: TheaterRole }))
    .max(500)
    .default([]),
});
export type UserCreateInput = z.input<typeof UserCreateInput>;

export const UserCreateOutput = z.object({
  user: UserView,
  /** Shown once to whoever created the user. Only a hash is stored. */
  temporaryPassword: z.string(),
});

export const UserUpdateInput = z.object({
  id,
  name: z.string().trim().min(1).max(120).optional(),
  isSuperAdmin: z.boolean().optional(),
});

export const MembershipSetInput = z.object({ userId: id, theaterId: id, role: TheaterRole });
export const MembershipRemoveInput = z.object({ userId: id, theaterId: id });

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: Password,
});

/* ───────── audit ───────── */

export const AuditListInput = z.object({
  theaterId: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const AuditEntry = z.object({
  id,
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  theaterId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: isoDate,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const OkOutput = z.object({ ok: z.literal(true) });
