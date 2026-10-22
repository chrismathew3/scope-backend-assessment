> **Status: built.** This was the review draft. What shipped differs in three places:
> - Per-theater roles with a global super admin (instead of global roles).
> - A small built-in session auth (instead of Better Auth).
> - The CSV upload is sent as base64 bytes.
>
> README.md describes the system as built.

# Plan v2: Showtimes backend

Status: **draft for review.** Nothing has been migrated or built beyond the local setup.

Files to review alongside this:
- `server/src/db/schema.ts`: the proposed Drizzle schema
- `docs/schema-preview.sql`: the SQL drizzle-kit would generate from that schema (a dry run; nothing touched the database)

### What changed since v1
- A **super admin** role that provisions admins and viewers and manages theater memberships.
- **Real authentication** (Better Auth: password sessions stored in Postgres) replaces the mock user picker. An append-only audit log and Postgres row-level security add defense in depth.
- **tRPC + Zod end to end**, plus a generated **OpenAPI spec** and docs page built from the same schemas.
- The API is modeled as **CRUD per resource**, derived from the use cases.
- A **migration workflow with a review gate**: generate, you review, then migrate. We never use `drizzle-kit push`.
- A full **CSV edge-case catalogue**, borrowing from open-source importers.
- A **Tailwind audit**, which found one bug.
- A **README requirement traceability** table.

---

## 1. Repo layout

Today the repo holds a Next app at the root plus `server/`. For the frontend to consume backend types cleanly, the cleanest setup is a Bun workspace:

```
apps/web          Next.js app (moved from the repo root, UI unchanged)
apps/api          Hono + tRPC + Drizzle (today's server/)
packages/shared   Zod schemas, enums, permission matrix, inferred types
```

- One `bun install` and one lockfile.
- Root scripts: `dev` (web + api), `typecheck`, `lint`, `test`, `db:generate`, `db:migrate`, `db:seed`.
- The README quickstart gets rewritten to match.
- Next rewrites `/api/*` and `/trpc/*` to the API, so the browser sees one origin: no CORS, and session cookies just work.

**Decision:** move to `apps/` + `packages/` (my recommendation), or keep Next at the root and add `server/` + `shared/` next to it. Keeping it at the root disturbs the original repo less, but the tsconfig and type sharing get messier.

---

## 2. Roles and permissions

Three global roles. Theater access is a separate many-to-many relationship (`theater_membership`), so every user belongs to zero or more theaters regardless of role.

| Role | Purpose |
|---|---|
| `super_admin` | Manages people and theaters: invites users, sets roles, grants and revokes theater memberships, creates and archives theaters |
| `admin` | Read + write on the schedules of the theaters they belong to |
| `viewer` | Read only, limited fields, on the theaters they belong to |

**Scope rule (README: "users can only see movies for theaters they belong to") applies to every role, super admins included.** A super admin can manage any theater's *membership*, but sees a theater's *showtimes* only after granting themselves membership, and that grant is audited. This gives least privilege and complies with the README literally.

### The explicit permission matrix

It lives in `packages/shared/permissions.ts` as a plain typed object. The API enforces it and the UI reads the same object to hide controls. A table-driven test covers every role × permission × in-scope/out-of-scope combination.

| Permission | super_admin | admin | viewer |
|---|---|---|---|
| `theater.read` | member theaters (+ all for management lists) | member | member |
| `theater.create / update / archive` | ✓ | – | – |
| `user.read` | all | users in own theaters | self |
| `user.invite` (role = admin or super_admin) | ✓ | – | – |
| `user.invite` (role = viewer) | ✓ | own theaters ⚑ | – |
| `user.updateRole` | ✓ (not self; never removes the last super admin) | – | – |
| `user.deactivate / reactivate` | ✓ (not self) | – | – |
| `membership.grant / revoke` | ✓ | viewers in own theaters ⚑ | – |
| `showtime.read` public fields, active only | ✓ | ✓ | ✓ |
| `showtime.read` internal fields + all statuses | ✓ | ✓ | – |
| `showtime.update` (`movieStatus`, `status`) | member | member | – |
| `schedule.archiveAll` | member | member | – |
| `import.create / apply / discard / read` | member | member | – |
| `audit.read` | all | own theaters | – |

⚑ = decision for you (see §13). The default I'd pick is that admins can onboard viewers into their own theaters, so the super admin isn't a bottleneck.

**What viewers can see (README: "read access to limited data"):**
- Fields: theater, movie title, auditorium, start, end, language, format, rating.
- Rows: `status = active` only.
- Hidden: `movieStatus`, `status`, timestamps, import history, other users.

**Guardrails:**
- No one can change their own role or memberships.
- The last active super admin can't be demoted or deactivated.
- Deactivating a user revokes all of their sessions immediately.
- The first super admin is created only from the CLI (`bun run user:create-super-admin`), never through the API.

### Enforcement layers (each one alone would block a viewer write)
1. **Authentication:** tRPC middleware resolves the session cookie, then **reloads the user, role, status and memberships from the database on every request**. Nothing is trusted from the client, and a cached role can't go stale.
2. **Authorization:** `can(ctx.user, "showtime.update", { theaterId })` runs in each procedure, against the matrix above.
3. **Data scoping:** every showtime and import query goes through one helper that injects `theater_id = ANY(:memberTheaterIds)`. Asking for a theater you're not in returns 404, not 403, so callers can't probe which theaters exist.
4. **Output shaping:** procedures return through role-specific Zod schemas (`ShowtimeViewer` vs `ShowtimeAdmin`). Extra fields get stripped, so a new column can't leak by accident.
5. **Postgres RLS** ⚑ on `showtime`, `import` and `import_row`. Each request runs in a transaction that sets `app.user_id`, and the policies check membership. The app connects as a non-owner role, so RLS can't be bypassed. Even a missed `WHERE` clause returns nothing.
6. **Audit:** every mutation writes an `audit_log` row with before/after JSON, the actor, IP and request id. The migration revokes `UPDATE`/`DELETE` on that table from the app role.

---

## 3. Authentication

**Better Auth** (v1.7): TypeScript-native, ships a Hono handler and a Drizzle adapter, and is actively maintained. Lucia is deprecated, and rolling our own is a compliance liability.

- **Email + password:**
  - Passwords are hashed with Better Auth's built-in scrypt. Minimum length 12, with a check against common passwords.
  - Sign-in is rate-limited per IP and per email.
  - Sessions live in the Postgres `session` table, behind an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
  - Sessions expire after 12 h of idle time.
  - Every session can be revoked (sign out everywhere, and automatically on deactivate or role change).
- **No public sign-up.**
  - Users exist only by invite: the super admin (or an admin, for viewers) creates the user with `status = invited`.
  - That generates a one-time set-password link stored in the `verification` table, valid for 72 h.
  - There's no email provider yet, so in dev the link is printed to the API log and shown to the inviter. Plugging in Resend or Postmark later is a single function.
- **2FA (TOTP) required for admins and super admins** ⚑ via Better Auth's `twoFactor` plugin. It's cheap to add, and it's what a compliance reviewer looks for first.
- **Dev experience:** the seed creates the 5 fixture users plus one super admin, all with a dev password from `apps/api/.env.example`. The login page has a dev-only "sign in as…" list (stripped from production builds) so role switching stays as fast as today's picker.
- **Mapping the fixture data:**
  - Avery and Casey become `admin`, Riley, Morgan and Jordan become `viewer`, and a new user, `Sam Super`, becomes `super_admin` with no theaters.
  - Each user's `theaterIds` become membership rows.
  - Jordan keeps zero memberships, which tests the empty state.

---

## 4. Schema

Full source: `server/src/db/schema.ts`. Generated SQL: `docs/schema-preview.sql`.

| Table | Rows come from | Key points |
|---|---|---|
| `user` | fixture `users` | Better Auth core columns + `role`, `status`, `invited_by`. Email unique, case-insensitive |
| `session`, `account`, `verification` | Better Auth | `account.password` holds the hash only |
| `theater` | fixture `theaters` | `name` unique, case-insensitive (CSV rows reference theaters by name). `schedule_version` drives the optimistic lock on imports |
| `theater_membership` | fixture `users[].theaterIds` | PK `(user_id, theater_id)`. Zero rows = sees nothing. Records `granted_by` |
| `showtime` | fixture `showtimes` | see below |
| `import` | each CSV upload | file hash, base `schedule_version`, counts, status (`previewed → applied / discarded / stale / failed`), expiry |
| `import_row` | each CSV line | raw values, normalized values, outcome, matched showtime, match method, diffs, errors, warnings: a complete trail of what came in and what was done |
| `audit_log` | every mutation | append-only |

**`showtime` details:**
- `movie_title` is the cleaned display value. `movie_title_key` is the normalized key used for matching and search (rules in §8).
- `auditorium` plus an `auditorium_key` ("Aud 1" → "auditorium 1"), so reports can group renamed auditoriums.
- `start_time` and `end_time` are `timestamptz`, with `CHECK (end_time > start_time)`.
- `language`, `format` and `rating` are text normalized on write. They're not DB enums, because partners will send "4DX" or "Dolby" and an enum would make each new value a migration.
- `status`, `movie_status`, `source_updated_at` (the CSV's `last_updated`), `last_import_id`, `version` (optimistic lock for admin edits), `archived_at`, `created_at`, `updated_at`.
- **`UNIQUE (theater_id, movie_title_key, start_time) WHERE status = 'active'`**: the README's "at most one active showtime" rule, enforced by the database itself.
- Indexes:
  - scope + status + start (the default list, and the keyset cursor)
  - GIN trigram on the title key (search)
  - title sort
  - updated-at sort

**Where `movieStatus` lives:** on the showtime, as in the fixture (Dune is `needs-review` on one showing and `approved` on another). CSV drops don't carry it, so imports never overwrite it. New rows default to `needs-review`.

**IDs:** text UUIDs. The fixture ids (`theater-downtown`, `st-dt-001`) are kept on seed, so the data is easy to recognize.

### Migration workflow
1. `0000_extensions.sql` (custom, hand-written): `pg_trgm`, `unaccent`, and an `immutable_unaccent()` wrapper so it can be indexed.
2. `bun run db:generate` writes `0001_init.sql` from `schema.ts`. **You review that file in the PR.**
3. `0002_security.sql` (custom): the app DB role, RLS policies, and `REVOKE UPDATE, DELETE ON audit_log`.
4. `bun run db:migrate` applies the migrations in order, recorded in drizzle's journal table. `push` is never used, not even in dev.
5. `bun run db:seed` loads the fixture. `bun run db:seed:scale` adds 500k synthetic showtimes for search benchmarks.

---

## 5. Type safety: Zod → tRPC → React, plus OpenAPI

```
packages/shared   Zod schemas (inputs, outputs, enums) ─┐
                                                        ├─► apps/api  tRPC procedures (.input/.output)
                                                        │      ├─► /trpc/*            (web app)
                                                        │      ├─► /api/v1/*  REST    (trpc-to-openapi)
                                                        │      └─► /api/openapi.json + /api/docs (Scalar)
                                                        └─► apps/web  forms validate with the same schemas
apps/web  ◄── `import type { AppRouter }` ── RouterInputs / RouterOutputs, zero codegen
```

- **Packages:**
  - Server: tRPC v11 (`@trpc/server`), mounted on Hono with `@hono/trpc-server`.
  - Client: `@trpc/tanstack-react-query`, on TanStack Query v5.
  - REST and docs: `trpc-to-openapi` v3, which supports Zod 4 and generates both the REST handlers and the spec from each procedure's `meta.openapi`. Scalar serves the docs UI.
- **Zod 4 everywhere.** The frontend upgrades from Zod 3, and `@t3-oss/env-nextjs` goes from 0.12 to 0.13. `drizzle-zod` validates database inserts only; the public API schemas are hand-written in `shared`, so the API contract never changes just because a column did.
- **Contract test:** a type-level test asserts that the shared output schemas line up with Drizzle's row types, so drift between them fails `tsc`.
- `src/types/assessment.ts` is deleted, and every type becomes `z.infer<>` or `RouterOutputs[...]`.
- **Errors:** tRPC error codes map to HTTP codes (`UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `BAD_REQUEST` 400 with field-level Zod issues). Error output is the same shape for tRPC and REST.

---

## 6. API: CRUD per resource

Every procedure has a REST twin at `/api/v1`. "Delete" means **archive**: nothing that touches the schedule or users is ever hard-deleted, because of the compliance requirement.

| Resource | Procedure | REST | Who | Use case |
|---|---|---|---|---|
| session | `auth.*` (Better Auth) | `/api/auth/*` | public | sign in/out, accept invite, set password, 2FA |
| me | `me.get` | `GET /me` | any | role, theaters, permission list for the UI |
| theaters | `theaters.list` | `GET /theaters` | any (scoped) | theater scope dropdown |
| | `theaters.get` | `GET /theaters/{id}` | any (scoped) | |
| | `theaters.create` | `POST /theaters` | super | onboard a theater |
| | `theaters.update` | `PATCH /theaters/{id}` | super | rename, timezone |
| | `theaters.archive` | `DELETE /theaters/{id}` | super | soft-archive |
| users | `users.list` | `GET /users` | super; admin (own theaters) | people management |
| | `users.get` | `GET /users/{id}` | same | |
| | `users.invite` | `POST /users` | super; admin → viewer ⚑ | provision |
| | `users.update` | `PATCH /users/{id}` | super | name, role |
| | `users.deactivate` / `reactivate` | `POST /users/{id}/deactivate` | super | offboard, kills sessions |
| memberships | `memberships.list` | `GET /theaters/{id}/members` | super; admin | |
| | `memberships.grant` | `PUT /theaters/{id}/members/{userId}` | super; admin → viewer ⚑ | |
| | `memberships.revoke` | `DELETE /theaters/{id}/members/{userId}` | same | |
| showtimes | `showtimes.list` | `GET /showtimes` | any (scoped, role-shaped) | search, filter, sort, paginate |
| | `showtimes.get` | `GET /showtimes/{id}` | any (scoped) | |
| | `showtimes.facets` | `GET /showtimes/facets` | any (scoped) | filter dropdown values |
| | `showtimes.update` | `PATCH /showtimes/{id}` | admin | `movieStatus` / `status`, with `expectedVersion` |
| | `showtimes.archiveAll` | `POST /theaters/{id}/schedule/archive` | admin | "Clear Schedule" button |
| imports | `imports.create` | `POST /theaters/{id}/imports` | admin | upload → parse → preview diff |
| | `imports.list` | `GET /theaters/{id}/imports` | admin | history |
| | `imports.get` | `GET /imports/{id}` | admin | reopen a preview, with row-level detail |
| | `imports.apply` | `POST /imports/{id}/apply` | admin | confirm |
| | `imports.discard` | `DELETE /imports/{id}` | admin | cancel |
| audit | `audit.list` | `GET /audit` | super; admin (own theaters) | compliance trail |

There's no `showtimes.create` or manual delete: the schedule only arrives through CSV imports, per the README. A manual "add showtime" form is a one-procedure addition later if you want it.

**Upload transport:** the file goes as `FormData` to a non-batched tRPC link (tRPC v11 supports non-JSON inputs). The limit is 20 MB, about 150k rows. If `trpc-to-openapi` can't describe multipart cleanly, the REST upload becomes a small Hono route that calls the same service, and I'll document it in the spec by hand.

---

## 7. Search at scale

- **Query shape:** `showtimes.list({ theaterId?, q?, status?, format?, language?, rating?, auditorium?, movieStatus?, from?, to?, sort, order, cursor?, limit≤100 })`.
- **Name search:**
  - The query `q` goes through the same normalizer as titles, then matches with `movie_title_key ILIKE '%q%' OR movie_title_key % q`, both served by the GIN trigram index.
  - Results are ranked by `similarity()` when `q` is present.
  - Short queries (1–2 characters) fall back to a prefix match, since trigrams need 3 characters.
- **Filters:** the composite index `(theater_id, status, start_time, id)` covers the default view. The other filters are low-cardinality and get combined in bitmap scans.
- **Sort:** a whitelist (`startTime`, `endTime`, `movieTitle`, `lastUpdated`, `movieStatus`, `theaterName`), always with `id` as a tiebreaker.
- **Pagination:**
  - Keyset cursors (an opaque base64 of the sort value + id), never `OFFSET`.
  - Counts are capped at 10,000 ("10,000+").
  - Facets are computed over the scoped set with the same filters.
- **Proof:** the 500k-row seed, with `EXPLAIN (ANALYZE, BUFFERS)` for the 5 main query shapes saved in `docs/search-benchmarks.md`. The target is p95 under 50 ms locally.
- Full-text search (`tsvector`) is skipped on purpose. Titles are short and the typos happen inside words, which is exactly what trigrams handle.

---

## 8. CSV upload: pipeline and edge cases

### What we borrow from open-source importers
| Source | What we take |
|---|---|
| **react-spreadsheet-import** (UgnisSoftware) | Its flow: upload → find the header row → match columns with alias lists (`alternateMatches`) → validate with row-level errors → confirm. We use the alias map and header detection server-side, and the preview modal stays as the confirm step |
| **Papa Parse / csv-parse** | Delimiter sniffing, BOM handling, `relax_column_count` to *report* ragged rows instead of crashing, `skip_empty_lines`, CRLF/CR handling, quoted newlines |
| **ODI CSVLint** error catalogue | File-level error names: `invalid_encoding`, `ragged_rows`, `blank_rows`, `duplicate_column_name`, `empty_column_name`, `title_row`, `whitespace`, `line_breaks` |
| **Frictionless Data** (goodtables) | Row error types: `missing-cell`, `extra-cell`, `type-error`, `constraint-error`, `unique-error`, plus the idea of a structured validation report |
| **Flatfile / OneSchema** (commercial, studied for UX) | Errors are always shown inline per row and column. Warnings never block the import. The import is never all-or-nothing just because some rows are bad |

### Pipeline
1. **Receive.** Check size (20 MB) and MIME type/extension (`.csv`, `text/csv`, `text/plain`, and Excel's `application/vnd.ms-excel` that it sends for CSVs). Compute the SHA-256.
2. **Decode.**
   - Strip a UTF-8 BOM.
   - Detect UTF-16 by its BOM and decode it.
   - Otherwise decode as strict UTF-8. If that fails, fall back to Windows-1252 with a warning (Excel exports from Windows).
3. **Parse** with `csv-parse`, sniffing the delimiter from `, ; \t |`. Ragged rows are recorded, not fatal.
4. **Header.**
   - Find the header row within the first 5 lines (skips "Partner Export – March" title rows).
   - Normalize header names: lowercase, strip non-letters, then map through aliases (`movie_title | title | film | movie name | movieTitle` → `movie_title`, and so on).
   - A missing required column rejects the file with a precise message. Unknown columns are ignored with a warning. A duplicate column rejects the file.
5. **Clean each cell.**
   - NFKC normalization.
   - Strip zero-width and control characters (`U+200B`, `U+FEFF` mid-file, `\u0000`).
   - Turn NBSP into a space. Map Unicode dashes (`‐ ‑ ‒ – — −`) to `-` and smart quotes to plain quotes.
   - Trim, and collapse internal whitespace.
6. **Validate each row with Zod** (`CsvRowSchema` in `shared`), collecting every error per row rather than stopping at the first.
7. **Normalize values:**
   - Times: see §8 edge cases.
   - Language: `en`, `eng` or `English` → `EN`.
   - Format: `3-D`/`3d` → `3D`, `imax` → `IMAX`, `2D` by default only if blank ⚑.
   - Rating: `PG13`/`pg-13` → `PG-13`; `Unrated`/`NR` → `NR`.
   - Auditorium: keep the display value as sent; the key maps `Aud`/`Auditorium`/`Screen`/`Theater` + a number or number word to `auditorium N`.
8. **Build the title key:**
   - lowercase → unaccent → `&` becomes `and` → punctuation becomes a space
   - number words become digits (one…twenty), and standalone roman numerals II–XX become digits
   - drop a leading "the" ⚑, collapse whitespace
   - So `Spider‑Man: Homecoming`, `  Spider Man - Homecoming  ` → `spider man homecoming`, and `DUNE PART 2`, `Dune: Part Two` → `dune part 2`.
9. **Dedupe within the file** on `(title_key, start_time)`:
   - An identical repeat is marked `duplicate`.
   - A repeat with *different* other fields is marked `duplicate` with a warning listing the conflicting fields. The first occurrence wins ⚑.
10. **Match** against the theater's non-archived showtimes, done as a set operation (an `UNNEST`/temp-table join, not N queries):
    1. Exact match on `(title_key, start_time)`.
    2. Otherwise, a fuzzy match: same `start_time`, trigram similarity ≥ 0.6, **and identical digit tokens**. Without that last rule, "Kung Fu Panda 4" would match "Kung Fu Panda 3", since the two titles are ~0.9 similar. If two candidates tie, it doesn't match; the row is added, with a warning.
    3. A row matching an **archived** showtime reactivates it instead of creating a new row, which keeps its id, history and `movieStatus`.
11. **Diff.**
    - A match with changed fields is an `update`, with per-field old and new values, the shape the modal already renders.
    - A match with no changes is `unchanged` (only `source_updated_at` moves).
    - No match is an `add`.
    - An active showtime that isn't in the file gets archived.
12. **Preview:**
    - Persist the `import` and `import_row` records and return the summary plus the first 200 rows of each bucket, with the rest paged.
    - The preview expires after 30 min.
13. **Apply** in one transaction with `pg_advisory_xact_lock(theater)`:
    - Re-check `schedule_version` against the preview's version. If they differ: `409 STALE_PREVIEW`, and the import is marked `stale`.
    - Write adds, updates and archives in bulk, and bump `schedule_version`.
    - Write the audit rows.
    - The partial unique index is the final backstop: any violation rolls the whole import back.
    - Applying twice returns the first result (idempotent).

### Edge cases catalogue
| # | Case | Handling |
|---|---|---|
| **File** | | |
| F1 | Empty file / header only | Reject. Header only would archive the whole schedule; that's allowed only through the separate Clear Schedule action |
| F2 | Not a CSV (xlsx, binary, image renamed .csv) | Reject: NUL bytes or invalid text detected |
| F3 | Over 20 MB | Reject with 413 before parsing |
| F4 | UTF-8 BOM, UTF-16, Windows-1252 | Decode as in step 2, with a warning on the fallback |
| F5 | `;`, tab or `|` delimiter | Sniff the delimiter, and warn if it isn't a comma |
| F6 | CRLF / CR-only line endings, trailing blank lines | Normalized silently |
| F7 | Unbalanced quotes | Reject with the line number |
| F8 | Same file uploaded again (same hash) | Allowed. The preview will show 0 changes, plus a notice saying the file was already applied on <date> |
| F9 | Two admins previewing at once | Both previews are fine. The first apply wins; the second gets `409 STALE_PREVIEW` and re-previews |
| F10 | Admin edits a showtime between preview and apply | Bumps `schedule_version` → stale → re-preview |
| F11 | Every row names a different theater | Reject: "this file is for Riverside Multiplex, you're uploading to Downtown Cinema 7" |
| **Header** | | |
| H1 | Columns reordered | Fine; columns are mapped by name |
| H2 | `Movie Title`, `movieTitle`, `TITLE` | Alias map |
| H3 | Missing required column | Reject, naming the column and listing which ones were found |
| H4 | Extra columns | Ignored, with a warning |
| H5 | Duplicate or empty header names | Reject |
| H6 | Title or notes rows above the header | Header detection within the first 5 lines |
| **Row** | | |
| R1 | Blank / whitespace-only row | Skipped silently |
| R2 | Too few or too many cells | Row `rejected` (`missing-cell` / `extra-cell`) |
| R3 | Required value empty | Row `rejected` |
| R4 | `theater_name` differs from the target theater | Matched case- and space-insensitively. A genuine mismatch → row `rejected` |
| R5 | Spreadsheet formula injection (`=`, `+`, `-`, `@` at the start of a text field) | Prefixed with `'` on output and warned. The value is still stored as text |
| R6 | Very long values (over 300 characters) | Row `rejected` |
| R7 | Zero-width / control / NBSP / smart punctuation | Cleaned in step 5 |
| **Values** | | |
| V1 | ISO with `Z` or an offset | Parsed as given |
| V2 | **Naive local time** (`2025-03-15 18:00`) | Interpreted in the **theater's `timezone`** (the fixture has it for exactly this). Times that fall in a DST gap are rejected, and DST-ambiguous times get a warning and the earlier instant |
| V3 | US-format dates (`3/15/2025 6:00 PM`) | Accepted through an explicit list of formats. Ambiguous `dd/mm` vs `mm/dd` follows the theater's locale ⚑ |
| V4 | Unparseable date | Row `rejected` |
| V5 | `end <= start` | Row `rejected` |
| V6 | Runtime under 30 min or over 6 h | Warning only |
| V7 | Start date in the past | Warning only |
| V8 | `last_updated` older than what's stored | Warning "older data than current". Still applied ⚑ |
| V9 | Unknown language / format / rating | Kept as sent, uppercased, with a warning. Never rejected (new formats like 4DX appear all the time) |
| **Matching** | | |
| M1 | Title spelling, case, punctuation, number words | Title key (step 8) |
| M2 | Auditorium renamed | Not part of the match key, so it's an `update` |
| M3 | Sequels, `Panda 4` vs `Panda 3` | The digit-token rule blocks the fuzzy match |
| M4 | Same movie, same time, two auditoriums | The README rule allows only one active row: the first wins, the second is `duplicate` with a warning |
| M5 | Showtime moved by 15 min | That's a new start time, so add + archive. We don't guess by proximity; the preview makes it visible |
| M6 | Fuzzy ties | No match: add + warn |
| M7 | Previously archived showtime reappears | Reactivated, keeping its id and `movieStatus` |
| M8 | Showtime an admin set to `inactive` | Updated if present, but stays `inactive` (an admin's hold beats the feed). Archived if missing ⚑ |
| M9 | Admin-set `movieStatus` | Never touched by imports |
| **Reconcile** | | |
| X1 | Missing from drop → archive (README) | Includes past showtimes ⚑ |
| X2 | Drop would archive over 50% of active showtimes | A loud warning in the preview, plus a typed confirmation |
| X3 | 100k-row file | Set-based matching, batched inserts, rows paged in the preview. Target: preview in under 5 s |

### Expected result for `new-drop.csv` against the seeded fixture (this becomes a test)
- **Updates:**
  - `st-dt-001`: auditorium and title spelling.
  - `st-dt-002`: auditorium and spacing.
  - `st-dt-003`: auditorium and title (its format is already IMAX in the JSON).
- **Unchanged:** `st-dt-004` (Dune 22:45; only `source_updated_at` moves).
- **Add:** Kung Fu Panda 4, 18:30, Auditorium 5. Its second copy in the file is a `duplicate`.
- **Archive:** `st-dt-007` (Kung Fu Panda 4 on 3/16). Wonka and Oppenheimer are already archived.

**Known data conflicts** (the JSON wins, documented in the README): the JSON and `existing.csv` disagree on Dune 20:00's format, Oppenheimer's rating, and whether Wonka and Oppenheimer are archived. The mocked preview in today's UI also doesn't match `new-drop.csv`.

---

## 9. Tailwind audit

The setup itself is correct for v4: `tailwindcss` 4.1.18, `@tailwindcss/postcss`, a CSS-first `@import "tailwindcss"` + `@theme`, and no `tailwind.config.js` needed. Fixes:

| Issue | Impact | Fix |
|---|---|---|
| **`bg-opacity-50` / `bg-opacity-30`** (4 places in `PreviewModal`) | **Bug.** v4 removed these utilities and they're absent from the built CSS, so the modal backdrop is solid black and the add/update/archive cards are opaque | `bg-black/50`, `bg-green-950/30`, etc. |
| `focus:outline-none` (13 places) | In v4 this means `outline-style: none`, which also disappears in Windows high-contrast mode | `focus:outline-hidden` |
| `bg-gradient-to-b` | Still works as a legacy alias | `bg-linear-to-b` |
| `placeholder-gray-400` | Works, but it's the old form | `placeholder:text-gray-400` |
| Bare `border` (24 places) | v4's default border color is `currentColor`. Each use needs an explicit color, which I'll verify | Audit |
| Prettier class sorting | v4 needs `tailwindStylesheet` set, and **6 files currently fail `prettier --check`** | Set `tailwindStylesheet: "./src/styles/globals.css"`, run `format:write`, add `format:check` to CI |
| Repeated hex values (`#1a0b2e`, `#0f0720`) and purple/gray everywhere | Drift | Move them into `@theme` tokens (`--color-surface`, `--color-brand`) |
| `next lint` is deprecated | Warning today, breaks on Next 16 | Run the official codemod to move to the ESLint CLI |

I'll run the official `npx @tailwindcss/upgrade` first and then review its diff, so we don't hand-edit what the tool can do.

---

## 10. Frontend changes (keep the look, swap the plumbing)
- A login page and a session-aware layout. Unauthenticated users are redirected to `/login`.
- `assessmentData` and `useMockSession` are removed. Data comes from `trpc.showtimes.list.useInfiniteQuery`. Filters, search, sort and the cursor live in the URL (`nuqs`), so views can be shared and survive a refresh.
- `ShowtimesTable` stops filtering and sorting locally and just renders server results. Column headers send the `sort` param, and there's infinite scroll or "load more".
- Admin controls render from `me.permissions` through the shared `can()`, not `role === "admin"`.
- Upload sends the file, the modal shows the real diff (including warnings, rejected rows and the over-50% archive warning), and Confirm calls `apply`, handling a 409 stale result by re-previewing.
- A new **People** page (super admins; admins for viewers ⚑) for users, invites, roles and memberships.
- A new **Import history** tab per theater (admins), plus an **Audit** view.
- Remove the mock callout, the unused `@supabase/supabase-js`, and the broken Jest `test` script (tests use `bun test`).

---

## 11. README requirements traceability

| README requirement | Where it's met | Proven by |
|---|---|---|
| Admin and non-admin views | §2 roles, §10 UI from permissions | Click-through as each seeded user |
| Admin has full read/write | permission matrix, `showtimes.update`, imports, archiveAll | policy matrix test + API integration tests |
| Non-admin has read access to limited data | `ShowtimeViewer` output schema, active-only filter | integration test: a viewer response has no `movieStatus` and no archived rows |
| Users belong to some, none, or all theaters | `theater_membership` (0..n) | seed covers 0 (Jordan), 1 (Riley), 2 (Morgan, Avery), all (Casey) |
| Users only see movies for their theaters | scoping helper + RLS | test: requesting a non-member theater → 404; a list never contains foreign rows |
| Admin can update a movie status field non-admins can't | `showtimes.update` requires `showtime.update` | test: a viewer PATCH → 403, and the UI shows no select |
| Schema based on the JSON | §4, `schema.ts` | seed loads the fixture 1:1 |
| Search at scale: name, filters, sort | §7 | 500k seed + EXPLAIN benchmarks |
| CSV cleaning: one active per movie + start + theater | step 9 dedupe + partial unique index | test + DB constraint |
| CSV: minor differences update the same showtime | title key, auditorium not in the key, fuzzy fallback | `new-drop.csv` expected-result test |
| CSV: missing showtimes archived | step 11 | same test (`st-dt-007`) |
| Schedule persisted in the database | apply transaction | test: re-read after apply |

---

## 12. Testing and done criteria
- **`bun test` unit tests:**
  - the title and auditorium normalizers (table of real messes)
  - the CSV decoder and header mapper
  - the reconciler on every edge case above (one fixture CSV per case in `apps/api/test/fixtures/csv/`)
  - the full permission matrix
- **Integration tests:** against a throwaway `scope_showtimes_test` database, run through the tRPC caller as each role, covering scoping, output shaping, 403/404, stale import, idempotent apply, and audit rows written.
- **Done means:**
  - `bun run typecheck`, `lint`, `format:check`, `test` and `next build` are all green.
  - The OpenAPI spec validates.
  - A click-through as all 6 seeded users is screenshotted at desktop and phone width.

---

## 13. Build order
1. Workspace restructure, shared package, Zod 4 upgrade, Tailwind fixes.
2. **Schema review gate:** you approve `schema.ts` and the generated SQL, then migrate and seed.
3. Better Auth, the CLI to create the super admin, invites, the session middleware, and the permission matrix + tests.
4. tRPC + OpenAPI skeleton: `me` and `theaters`, with docs live at `/api/docs`.
5. Showtimes: list/search/facets/update/archiveAll, RLS, audit, the scale seed and benchmarks.
6. CSV pipeline + the edge-case test suite, then imports CRUD.
7. Users and memberships CRUD and the People page.
8. Frontend wiring, then the final verification pass and the README rewrite.

---

## 14. Decisions for you (my recommendation first)
1. **Repo layout:** move to `apps/web`, `apps/api`, `packages/shared` (recommended), or keep Next at the root?
2. **Can admins invite viewers and grant them membership in their own theaters?** I recommend yes. The alternative is that only the super admin provisions anyone.
3. **Super admin showtime access:** only through explicit membership (recommended; matches the README literally), or implicit access to all theaters?
4. **2FA required for admins and super admins:** recommended yes.
5. **Postgres RLS as a second enforcement layer:** recommended yes. It adds one transaction per request.
6. **Viewers see:** active showtimes only, without `movieStatus`/`status` (recommended). Or also hide showtimes whose movie isn't `approved`?
7. **Missing-from-drop archiving:** archive everything missing, as the README says (recommended), or only future showtimes?
8. **Stale feed (`last_updated` older than stored):** apply with a warning (recommended), or skip those rows?
9. **Same movie + same start in two auditoriums within one file:** first row wins with a warning (recommended), or reject both?
10. **An admin-set `inactive` showtime appears in a new drop:** keep it inactive (recommended), or reactivate it?
