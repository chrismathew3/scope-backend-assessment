/**
 * Database schema. Shape comes from apps/web/src/data/assessment-data.ts and
 * sample-data/*.csv. SQL that Drizzle can't express (extensions, RLS, grants)
 * lives in the hand-written migrations under ../../drizzle.
 */
import { sql } from "drizzle-orm";
import type { AgentRun } from "@scope/shared";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  real,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  IMPORT_ROW_OUTCOMES,
  IMPORT_STATUSES,
  MOVIE_STATUSES,
  SHOWTIME_STATUSES,
  THEATER_ROLES,
  USER_STATUSES,
} from "@scope/shared";

/** Agent record for imports where no model ran. */
export const AGENT_OFF: AgentRun = {
  status: "off",
  model: null,
  summary: null,
  error: null,
  durationMs: null,
  overrides: 0,
  corrections: 0,
  trace: [],
};

const id = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`);
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ───────────────────────── enums ───────────────────────── */

export const theaterRole = pgEnum("theater_role", THEATER_ROLES);
export const userStatus = pgEnum("user_status", USER_STATUSES);
export const showtimeStatus = pgEnum("showtime_status", SHOWTIME_STATUSES);
export const movieStatus = pgEnum("movie_status", MOVIE_STATUSES);
export const importStatus = pgEnum("import_status", IMPORT_STATUSES);
export const importRowOutcome = pgEnum("import_row_outcome", IMPORT_ROW_OUTCOMES);

/* ───────────────────────── people & auth ───────────────────────── */

export const users = pgTable(
  "user",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // scrypt, never plain text
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Admin of every theater + user/theater management.
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    status: userStatus("status").notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("user_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "session",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the cookie token. A database leak doesn't leak live sessions.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tz("expires_at").notNull(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

/* ───────────────────────── tenancy ───────────────────────── */

export const theaters = pgTable(
  "theater",
  {
    id: id(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    timezone: text("timezone").notNull(), // IANA, validated by Zod
    // Bumped on every schedule write; import apply checks it (optimistic lock).
    scheduleVersion: integer("schedule_version").notNull().default(0),
    archivedAt: tz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // CSV rows name the theater, so names are unique (case-insensitive).
  (t) => [uniqueIndex("theater_name_lower_uq").on(sql`lower(${t.name})`)],
);

// Zero or more theaters per user, each with its own role.
export const theaterMemberships = pgTable(
  "theater_membership",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    theaterId: text("theater_id")
      .notNull()
      .references(() => theaters.id, { onDelete: "cascade" }),
    role: theaterRole("role").notNull(),
    grantedBy: text("granted_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.theaterId] }),
    index("membership_theater_idx").on(t.theaterId),
  ],
);

/* ───────────────────────── schedule ───────────────────────── */

export const showtimes = pgTable(
  "showtime",
  {
    id: id(),
    theaterId: text("theater_id")
      .notNull()
      .references(() => theaters.id),
    movieTitle: text("movie_title").notNull(), // cleaned display value
    movieTitleKey: text("movie_title_key").notNull(), // normalized match + search key
    movieStatus: movieStatus("movie_status").notNull().default("needs-review"),
    auditorium: text("auditorium").notNull(),
    auditoriumKey: text("auditorium_key").notNull(), // "Aud 1" -> "auditorium 1"
    startTime: tz("start_time").notNull(),
    endTime: tz("end_time").notNull(),
    language: text("language").notNull(),
    format: text("format").notNull(),
    rating: text("rating").notNull(),
    status: showtimeStatus("status").notNull().default("active"),
    sourceUpdatedAt: tz("source_updated_at"), // CSV last_updated
    lastImportId: text("last_import_id"),
    version: integer("version").notNull().default(1), // optimistic lock for admin edits
    archivedAt: tz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("showtime_time_order", sql`${t.endTime} > ${t.startTime}`),
    // README: at most one ACTIVE showtime per movie + start per theater.
    uniqueIndex("showtime_active_uq")
      .on(t.theaterId, t.movieTitleKey, t.startTime)
      .where(sql`${t.status} = 'active'`),
    // Default list view + keyset cursor.
    index("showtime_scope_idx").on(t.theaterId, t.status, t.startTime, t.id),
    index("showtime_start_idx").on(t.startTime, t.id),
    // Name search at scale: substring + fuzzy via pg_trgm.
    index("showtime_title_trgm_idx").using("gin", t.movieTitleKey.op("gin_trgm_ops")),
    index("showtime_title_sort_idx").on(t.movieTitleKey, t.id),
    index("showtime_updated_idx").on(t.updatedAt, t.id),
  ],
);

/* ───────────────────────── CSV imports ───────────────────────── */

export const imports = pgTable(
  "import",
  {
    id: id(),
    theaterId: text("theater_id")
      .notNull()
      .references(() => theaters.id),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: importStatus("status").notNull().default("previewed"),
    baseScheduleVersion: integer("base_schedule_version").notNull(),
    totalRows: integer("total_rows").notNull(),
    addCount: integer("add_count").notNull().default(0),
    updateCount: integer("update_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    archiveCount: integer("archive_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    activeBefore: integer("active_before").notNull().default(0),
    notices: jsonb("notices").$type<string[]>().notNull().default([]),
    archiveShowtimeIds: jsonb("archive_showtime_ids").$type<string[]>().notNull().default([]),
    /** Showtimes missing from the drop, with the reason and the reviewer's choice. */
    archiveProposals: jsonb("archive_proposals").$type<ArchiveProposal[]>().notNull().default([]),
    /** What the reconciliation agent did: status, model, summary, trace. */
    agent: jsonb("agent").$type<AgentRun>().notNull().default(AGENT_OFF),
    appliedBy: text("applied_by").references(() => users.id),
    appliedAt: tz("applied_at"),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("import_theater_idx").on(t.theaterId, t.createdAt),
    index("import_hash_idx").on(t.theaterId, t.fileSha256),
  ],
);

export type ArchiveProposal = {
  showtimeId: string;
  explanation: string;
  decisionSource: "ai" | "rules";
  accepted: boolean;
};

export type NormalizedRow = {
  movieTitle: string;
  movieTitleKey: string;
  auditorium: string;
  auditoriumKey: string;
  startTime: string;
  endTime: string;
  language: string;
  format: string;
  rating: string;
  lastUpdated: string | null;
};
type Issue = { column: string; message: string };

// One row per CSV line: what came in and what we did with it.
export const importRows = pgTable(
  "import_row",
  {
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    normalized: jsonb("normalized").$type<NormalizedRow>(),
    outcome: importRowOutcome("outcome").notNull(),
    showtimeId: text("showtime_id"),
    matchMethod: text("match_method"),
    diffs: jsonb("diffs")
      .$type<{ field: string; oldValue: string; newValue: string }[]>()
      .notNull()
      .default([]),
    errors: jsonb("errors").$type<Issue[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<Issue[]>().notNull().default([]),
    /** Plain-language reason for the proposed action. */
    explanation: text("explanation"),
    confidence: real("confidence"),
    decisionSource: text("decision_source").$type<"ai" | "rules">().notNull().default("rules"),
    aiOverrodeRules: boolean("ai_overrode_rules").notNull().default(false),
    duplicateOf: integer("duplicate_of"),
    /** Reviewer's choice; only accepted add/update rows are applied. */
    accepted: boolean("accepted").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.importId, t.lineNumber] })],
);

/* ───────────────────────── compliance ───────────────────────── */

// Append-only: the app role can INSERT and SELECT, never UPDATE or DELETE.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    theaterId: text("theater_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_theater_idx").on(t.theaterId, t.createdAt),
    index("audit_created_idx").on(t.createdAt),
  ],
);
