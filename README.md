# Theater Showtimes: AI-reviewed partner imports

Upload a partner's showtime CSV and an LLM agent compares it with the stored schedule. It resolves likely title and auditorium matches, finds new, changed, missing and duplicate rows, and proposes each action with a plain-language reason. You approve or reject each action, apply, and the outcome is saved with a full audit trail.

**Live:** https://scope-showtimes.vercel.app. Pick a role on the first screen; no sign-up is needed.
**Try it in 30 seconds:** sign in as **Avery Admin** → **Import CSV** → use **tricky-drop.csv** → untick anything you doubt → **Apply**.
**API docs:** https://scope-showtimes.vercel.app/api/docs

## How the AI review works

```
CSV ─▶ clean + validate (code) ─▶ candidate matches (code) ─▶ agent decides (LLM) ─▶ verifier (code) ─▶ review ─▶ apply (one transaction)
```

1. **Cleaning is deterministic.** The code handles:
   - encoding detection (UTF-8/16, Windows-1252)
   - delimiter sniffing, header aliases and title rows
   - Unicode dashes and spaces
   - times written without an offset, read in the theater's timezone
   - per-row validation: wrong theater, end before start, missing fields

   About 40 edge cases have unit tests.
2. **The agent decides.** Gemini 3 Flash runs as a tool-using agent (Vercel AI SDK). It gets each cleaned row and its likely candidates, and can call `searchSchedule` when the candidates look wrong. It finishes with `submitReview`: for every row, an action (add, update, unchanged, duplicate or skip), the showtime it matches, a confidence score, and a one-sentence reason.
3. **Code verifies every decision before you see it.** The model proposes; the code disposes:
   - A match must point at a real showtime in that theater, and each showtime can be claimed once.
   - A "moved" match must keep the film and stay within 3 hours.
   - Sequels never match (Kung Fu Panda 3 vs 4).
   - Field diffs are always computed by code, never written by the model.
   - Missing showtimes (to archive) are computed by code.
   - The "one active showtime per movie + start per theater" rule is enforced in code and by a Postgres partial unique index.
   - A "duplicate" must really repeat its target row.
   - The agent can't release a showtime the rules matched.
   - A malformed row that still names a showtime keeps that showtime off the archive list.
   - Any invalid AI decision falls back to the rule-based answer and is counted as a correction.
4. **Review, then confirm.**
   - Every proposed change shows the action, the change in words ("Aud 1 becomes Aud. 1, moves from 10:30 AM to 10:45 AM"), the agent's reason and its confidence. Below 75% it's marked *Check*.
   - Details show a before/after table and the raw CSV line.
   - The riskiest actions come first: updates, then archives, then new showtimes. Long lists of new showtimes collapse, with a bulk untick.
   - Changes start approved; untick the ones you doubt. Keyboard works too: j/k to move, Space to toggle, Cmd/Ctrl+Enter to apply.
   - Duplicates, unchanged rows and rows that couldn't be imported are listed, dimmed.
   - "How the agent decided" shows the agent's search steps and summary.
5. **Persisted.** Saved with the import:
   - each row's proposal, reason, confidence and source (AI or rules)
   - your approve/reject choices
   - the agent run (model, timing, trace)
   - an append-only audit entry

   Applying runs in one transaction. It's idempotent, and it refuses a stale preview if the schedule changed after you uploaded.
6. **When the AI is unavailable.** If the model errors or times out (45s budget), the rules decide every row, and the page says so plainly. Nothing breaks.

**Product decisions:**
- **Titles stay yours.** When a partner misspells a film ("Spiderman Homecomming"), the matched showtime keeps *your* title, and the partner's spelling is shown as a note. A new showtime of a film you already list takes your spelling too. Auditorium renames *are* applied, because the brief treats them as updates; you can untick any of them.
- **Prompt injection.** Cell text is untrusted data. The system prompt tells the agent never to follow it, the verifier rejects decisions that don't hold up against the data, and reasons that echo instructions are replaced. QA tried files whose titles told the agent to mark real showtimes as duplicates. Those rows are still decided correctly, and nothing is archived wrongly.
- **Large files.** Up to about 120 rows, the agent sees every row. Above that, it only sees rows that need judgement: likely matches and near-misses. The rules settle exact matches and plainly new titles. A 5,000-row file previews in under a second. If one batch fails, the others still count, and the rules fill in only that batch.

## Run it locally

Needs Bun ≥ 1.2 and Postgres ≥ 15 (`brew install postgresql@17 && brew services start postgresql@17`).

```bash
bun install
createdb scope_showtimes
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
bun run db:migrate && bun run db:seed
bun run dev
```

Open http://localhost:3000 and pick a role. The web app proxies `/trpc` and `/api` to the API on :8787.

**AI credentials:**
- **Easiest:** link the Vercel project and pull a token with `vercel env pull apps/api/.env.local --environment development`. The AI Gateway then works with no API key.
- **Alternative:** set `GEMINI_API_KEY` to call Google directly.
- **No credentials:** the app runs rules-only, and the review page says so.

| Command | What it does |
|---|---|
| `bun run dev` | Web + API with reload |
| `bun run test` | 113 unit tests: CSV cleaning, reconciliation, AI verifier (including injection cases), permission matrix |
| `bun run --filter @scope/api test:e2e` | 17 end-to-end scenarios against the running stack with the real agent: every role's visibility, search, edits, both samples, approvals honoured, stale/discard/large-archive, prompt injection, bad files, a 5,000-row file, people and access rules, database invariants. Resets demo data. Point `E2E_API`, `MIGRATION_DATABASE_URL` and `E2E_APP_DB` at production to run it there. |
| `bun run typecheck` / `lint` | `tsc` across packages / ESLint |
| `bun run db:reset` | Rebuild the local database from scratch |
| `bun apps/api/src/scripts/eval-agent.ts` | Compare models on both samples (accuracy, corrections, latency) |

## Key implementation decisions

- **Model.** Gemini 3 Flash at low thinking effort through the Vercel AI Gateway. In the eval it got 48/48 decisions right with 0 verifier corrections, at about 4 seconds and about $0.005 per drop. Claude Haiku 5.5 was equally accurate but needed 2 corrections and took 9.6 seconds. Gemini 2.5 Flash-Lite failed 3 runs. On Vercel the gateway authenticates with the project's own token, so no key is stored anywhere.
- **The LLM proposes, code verifies.** The model never writes to the database and never computes diffs. Everything it says is checked against the schedule, which keeps the agent useful (typos, renamed auditoriums, moved showings) without letting it corrupt data.
- **Stack.** Bun workspace:
  - `apps/web`: Next.js 15, React 19, Tailwind v4, TanStack Query.
  - `apps/api`: Hono, tRPC v11, Drizzle, Postgres.
  - `packages/shared`: Zod schemas and the permission matrix.

  The same Zod schemas validate the API, the forms and the generated OpenAPI spec (REST twin at `/api/v1`). On Vercel the API runs inside Next route handlers; locally it runs as a separate Bun server.
- **Access.** A role per theater (admin or viewer) plus a global super admin. Rules live in one file (`packages/shared/src/permissions.ts`). Viewers only receive public fields of active showtimes. Postgres row-level security backs this up, because the app connects as a non-owner role.
- **Search at scale.** A trigram GIN index on a normalized title key gives typo-tolerant search ("oppenhiemer" finds Oppenheimer), with filters, sorts and keyset pagination.
- **Database.** Neon Postgres provisioned through Vercel. The shared Supabase URL in the original `.env.example` was not used: it is shared across candidates, and our migrations create roles and policies.
- **Login.** The brief says auth isn't required. A one-click role picker is kept so reviewers can see admin, viewer, mixed and super-admin views. Demo accounts can't be locked out. Signed in as **Sam Super**, **Reset demo data** (user menu) restores the seed and removes people created during the demo, so the next reviewer starts clean.
- **Upload size.** CSVs up to 3 MB (about 30,000 rows), because Vercel caps request bodies at 4.5 MB. Beyond that, the next step would be direct upload to Blob storage.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Postgres URL for the `scope_app` role (row-level security applies) |
| `MIGRATION_DATABASE_URL` | API, local/CI | Owner URL for migrations and seeding |
| `AI_MODEL` | API | Gateway model id, default `google/gemini-3-flash` |
| `AI_THINKING` / `AI_TIMEOUT_MS` | API | Gemini thinking level (default `low`) / agent time budget (default 45000) |
| `GEMINI_API_KEY` | API, optional | Call Google directly instead of the AI Gateway |
| `AI_GATEWAY_API_KEY` | API, optional | Gateway key outside Vercel; on Vercel the project's own token is used |
| `DEMO_MODE` | API | `true` shows the role picker in production and enables demo reset |
| `API_URL` | Web, local only | Proxy target for the standalone API; unset on Vercel |

## Samples

| File | What it exercises |
|---|---|
| `sample-data/new-drop.csv` | The brief's sample: renamed auditoriums, reformatted titles, a duplicate, a missing showtime |
| `sample-data/tricky-drop.csv` | Heavy typo, roman numerals, "Dune Pt. II", a showtime moved 15 minutes, an archived film returning, a duplicate, a row for the wrong theater |

Both can be used from the import page without downloading anything.
