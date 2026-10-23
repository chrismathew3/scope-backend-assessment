# Theater Showtimes

A schedule console for movie theaters. Partners send showtime CSVs; an LLM agent compares each file with the stored schedule and proposes what to add, update, archive or ignore, with a reason for each. You review, untick anything you disagree with, and apply.

- Live: https://scope-showtimes.vercel.app
- API docs: https://scope-showtimes.vercel.app/api/docs

**Try it:** sign in as Avery Admin, click Import CSV, pick `tricky-drop.csv`, review, apply. The demo database is shared. Sam Super can restore it from the user menu (Reset demo data).

## Run it locally

You need Bun 1.3+ and Postgres 15+.

```bash
bun install
createdb scope_showtimes
cp apps/api/.env.example apps/api/.env   # set GEMINI_API_KEY here
cp apps/web/.env.example apps/web/.env
bun run db:migrate && bun run db:seed
bun run dev                              # web on :3000, API on :8787
```

A free Gemini key is enough for the agent. Without one, imports still work and plain rules decide every row.

Tests: `bun run test` (unit) and `bun run --filter @scope/api test:e2e` (end to end, against the running stack and the real model).

## Decisions

**The model proposes, code checks.** The agent reads each row with its likely matches and can search the schedule itself. Before anything reaches you, code verifies every decision: the matched showtime must exist and not be claimed twice, a sequel can't match its predecessor, and anything invalid falls back to the rule-based answer. Diffs and archive lists are computed by code, never by the model, so a CSV cell that says "ignore your instructions" can't do damage.

**Nothing changes until you apply.** Every proposed change, archives included, can be unticked. Apply is one transaction. It's safe to retry, and it refuses if the schedule changed after you uploaded.

**Your spelling wins.** A partner's typo still matches the right showtime, but your title stays; theirs is shown as a note. Auditorium renames are applied, since the brief treats them as updates.

**Access is per theater.** Each user is an admin or a viewer in any number of theaters. Admins can edit, add and archive showtimes (archiving is the delete, so nothing is lost). Viewers see active showtimes without internal fields. A super admin manages theaters and people. For showtimes and imports, Postgres row-level security enforces the same rules a second time.

**Search holds up at 500,000 rows.** Title search matches against a small catalog of distinct titles first, then looks up showtimes by index. On 500k rows, paging, sorts and filters take 2–13 ms and title search 30–50 ms; sorting by theater name is the slow one at up to 240 ms. Numbers and method: [docs/search-at-scale.md](docs/search-at-scale.md).

**Vercel AI Gateway instead of a raw Gemini key.** The email suggested Gemini's free API. I call Gemini 3 Flash through the AI Gateway because it's what I normally use and it was simpler: on Vercel it authenticates with the project's own token, so there's no API key to store, and switching models is a one-line change. A plain `GEMINI_API_KEY` still works for running it locally.

**TypeScript instead of the FastAPI stub.** One set of Zod schemas validates the API, the forms and the OpenAPI spec. Next.js 15 (`apps/web`), Hono + tRPC + Drizzle on Postgres (`apps/api`), shared schemas and permissions (`packages/shared`).

**A role picker instead of a login form.** The brief doesn't need auth, so you pick a role in one click. The sessions behind it are real because the site is public.

More on the pipeline, access rules and environment variables: [docs/how-it-works.md](docs/how-it-works.md).

## Sample files

`sample-data/` has the brief's `new-drop.csv`, a harder `tricky-drop.csv`, and one file each for Riverside and Uptown. The import page offers them directly.
