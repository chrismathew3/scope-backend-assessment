# Theater Showtimes

A theater schedule console with an AI-reviewed CSV import. An LLM agent compares a partner's showtime file with the stored schedule, matches title and auditorium variants, finds new, changed, missing and duplicate rows, and proposes an action for each with a reason. You untick what you disagree with and apply; the result is saved with an audit trail.

Live: https://scope-showtimes.vercel.app · API docs: https://scope-showtimes.vercel.app/api/docs

To try it, pick Avery Admin on the sign-in screen, then Import CSV, choose `tricky-drop.csv`, review and Apply. No sign-up. The demo database is shared; signed in as Sam Super, *Reset demo data* in the user menu restores it.

## Run it locally

Needs Bun ≥ 1.2 and Postgres ≥ 15.

```bash
bun install
createdb scope_showtimes
cp apps/api/.env.example apps/api/.env      # add GEMINI_API_KEY for the agent
cp apps/web/.env.example apps/web/.env
bun run db:migrate && bun run db:seed
bun run dev                                 # web :3000, API :8787
```

For the agent, the easiest option is a free Gemini API key in `GEMINI_API_KEY` (uses `gemini-3-flash-preview`); an AI Gateway key in `AI_GATEWAY_API_KEY` also works. With neither, imports still work: the rules decide every row and the review page says so.

`bun run test` runs 143 unit tests. `bun run --filter @scope/api test:e2e` runs 18 end-to-end scenarios against the running stack with the real agent.

## Key decisions

- **AI review.** Gemini 3 Flash runs as a tool-using agent (Vercel AI SDK) and decides each row. Code then checks every decision against the schedule: matches must be real and unclaimed, diffs and archives are computed by code, and an invalid decision falls back to the rule-based answer. The model never writes to the database, which also makes prompt injection in CSV cells harmless.
- **Review before apply.** Every proposed change, including each archive, shows its reason and confidence and can be unticked. Apply runs in one transaction, is idempotent, and refuses a stale preview if the schedule changed after upload.
- **Titles.** A partner's typo matches the right showtime but doesn't overwrite your title; their spelling shows as a note. Auditorium renames are applied, as the brief describes.
- **Access.** Each user is admin or viewer in any number of theaters; a super admin manages theaters and people. Admins can edit any field (movie status included), add, archive (archive is the delete, so history survives), import and clear. Viewers get public fields of active showtimes only. Postgres row-level security enforces the same rules again.
- **Search.** Title search goes through a trigram-indexed catalog of distinct titles, then an indexed lookup; sorts and keyset paging are index walks. On 500,000 showtimes, search, filters, sorts and paging take 2–22 ms. Sorting by theater name is the slow case, at up to 230 ms. See [docs/search-at-scale.md](docs/search-at-scale.md).
- **Stack.** The brief shipped a FastAPI stub. I used TypeScript end to end so one set of Zod schemas validates the API, the forms and the generated OpenAPI spec. Bun workspace: Next.js 15 + Tailwind v4 (`apps/web`), Hono + tRPC + Drizzle + Postgres (`apps/api`), shared schemas and permissions (`packages/shared`).
- **Login.** The brief says auth isn't required, so login is a one-click role picker for the admin, viewer, mixed and super-admin views. Sessions underneath are real (hashed tokens, rate-limited login) because the app is public.

The full AI pipeline and every environment variable are in [docs/how-it-works.md](docs/how-it-works.md).

## Samples

`sample-data/` holds the brief's `new-drop.csv`, a harder `tricky-drop.csv` (Downtown), and `riverside-drop.csv` / `uptown-drop.csv` for the other theaters. The import page offers each theater's samples directly and picks the theater from the file if none is selected.
