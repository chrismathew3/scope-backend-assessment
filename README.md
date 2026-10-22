# Theater Showtimes

Ingest a partner CSV, reconcile it against a theater's schedule, and manage showtimes with per-theater roles.

**Live demo:** https://scope-showtimes.vercel.app. Pick any demo account on the sign-in page (password `showtimes-dev-pass`).
**API docs (OpenAPI):** https://scope-showtimes.vercel.app/api/docs

## Stack

| Piece | Choice |
|---|---|
| Web | Next.js 15 (App Router), React 19, Tailwind v4, TanStack Query |
| API | Hono on Bun, tRPC v11, REST + OpenAPI generated from the same procedures (`trpc-to-openapi`) |
| Validation | Zod 4 schemas in `packages/shared`, used by the API, the forms and the OpenAPI spec |
| Database | Postgres 17, Drizzle ORM + drizzle-kit migrations, `pg_trgm` for search, row-level security |
| Auth | Email + password (scrypt), hashed session tokens in Postgres, httpOnly cookies |

```
apps/web         Next.js app (UI). On Vercel it also runs the API in-process.
apps/api         Hono + tRPC API, Drizzle schema/migrations, CSV pipeline
packages/shared  Zod schemas, enums and the permission matrix (used by both apps)
sample-data/     Partner CSVs from the brief
```

## Run it locally

Needs Bun ≥ 1.2 and Postgres ≥ 15 (`brew install postgresql@17 && brew services start postgresql@17`).

```bash
bun install
createdb scope_showtimes
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
bun run db:migrate
bun run db:seed
bun run dev
```

Open http://localhost:3000 and click a seeded account. The API runs on :8787. Next proxies `/trpc` and `/api` to it, so the browser sees one origin.

| Command | What it does |
|---|---|
| `bun run dev` | Web + API with reload |
| `bun run typecheck` | `tsc` across every package |
| `bun run test` | 95 unit tests (CSV cleaning, reconciliation, permission matrix) |
| `bun run lint` / `format:check` | ESLint / Prettier |
| `bun run db:generate` | New migration from `apps/api/src/db/schema.ts` (review the SQL before migrating) |
| `bun run db:migrate` / `db:seed` / `db:reset` | Apply migrations / load the fixture / rebuild locally |

## Access model

Users belong to **zero or more theaters, with a role in each** (`admin` or `viewer`). A **super admin** is an admin of every theater and also manages people and theaters. The rules live in one place, `packages/shared/src/permissions.ts`. The API enforces them and the UI reads them.

| | Viewer (in that theater) | Admin (in that theater) | Super admin |
|---|---|---|---|
| See showtimes | Active only, public fields | All rows and fields | Every theater |
| Change movie status / showtime status | – | ✓ | ✓ |
| Upload CSV, apply, clear schedule | – | ✓ | ✓ |
| Add/remove viewers | – | ✓ | ✓ |
| Grant admin, make super admin, deactivate, reset passwords | – | – | ✓ |
| Audit log | – | Their theaters | Everything |

Enforcement is layered:
1. The session is checked and roles are reloaded from the database on every request.
2. A `can()` check runs in each procedure.
3. Every query is scoped to the caller's theaters.
4. Responses go through role-specific Zod output schemas, so viewers never receive internal fields.
5. **Postgres row-level security:** the app connects as a non-owner role, so even a buggy query can't read another theater's rows.
6. An append-only audit log records every change; the app role can't update or delete it.

## Search at scale

- **Title search:** a GIN trigram index on a normalized title key. It handles substrings and typos ("oppenhiemer" finds Oppenheimer).
- **Filters:** theater, showtime status, movie status, format, language, rating, auditorium, and a date range.
- **Sorts:** start, end, title, theater, last updated, and movie status.
- **Pagination:** keyset (cursor) pagination, never `OFFSET`, with counts capped at 10,000.

## CSV import

Upload → **preview** (nothing changes yet) → apply, as one transaction.

**Cleaning:**
- Detects the encoding: UTF-8 BOM, UTF-16, and a Windows-1252 fallback.
- Sniffs the delimiter, and finds the header row, skipping any title rows above it.
- Matches header aliases (`Movie Title`, `film`, …).
- Normalizes Unicode dashes and spaces.
- Interprets times without an offset in the theater's own timezone.
- Normalizes language, format and rating values.

**Matching:**
- A showtime is identified by **theater + normalized title + start time**. "Spider‑Man: Homecoming" and "Spider Man - Homecoming" are the same showtime, and so are "DUNE PART 2" and "Dune: Part Two".
- Auditorium renames therefore count as updates.
- When the exact key doesn't match, a fuzzy title match is the fallback, but it never matches across sequel numbers.
- Duplicate rows within a file are skipped.

**Reconciling:**
- Showtimes missing from the drop are archived.
- A Postgres partial unique index guarantees at most one *active* showtime per movie + start per theater.
- A preview goes stale if the schedule changes before it's applied.
- Applying is idempotent.
- Archiving more than half the schedule needs an explicit confirmation.

## README requirements → where they're met

| Requirement | Where |
|---|---|
| Admin and non-admin views | Per-theater roles; admin-only columns and actions in `apps/web/src/app/(app)` |
| Admin read/write, non-admin limited read | `packages/shared/src/permissions.ts`, role-shaped output in `apps/api/src/services/showtime-query.ts` |
| Users belong to some, none or all theaters | `theater_membership` table; seed covers 0, 1, 2 and 3 theaters plus a super admin |
| Users only see their theaters' movies | Query scoping + RLS (`apps/api/drizzle/0002_security.sql`) |
| Admin-only movie status updates | `showtimes.update` (`PATCH /showtimes/{id}`) |
| Schema from the JSON | `apps/api/src/db/schema.ts`, fixture in `apps/api/src/db/fixtures.ts` |
| Search, filters, sort at scale | `apps/api/src/services/showtime-query.ts` |
| CSV cleaning, dedupe, archive missing, persisted | `apps/api/src/csv/*`, `apps/api/src/services/imports.ts` |

## Deploying (Vercel)

There's one Vercel project with root `apps/web`. The Next app serves the API through route handlers in `src/app/{trpc,api}`. Environment variables:
- `DATABASE_URL`: the `scope_app` role's URL, not the owner's, so RLS applies.
- `DEMO_MODE=true`: shows the demo logins and stops visitors locking the demo accounts.
- `WEB_ORIGIN`: the public URL.

Run migrations and seed from a laptop with `MIGRATION_DATABASE_URL` set to the owner connection.
