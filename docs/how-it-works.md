# How it works

This covers the AI review pipeline, the product decisions behind it, access rules and every environment variable. Search performance is in [search-at-scale.md](search-at-scale.md).

## The AI review

```
CSV ─▶ clean + validate (code) ─▶ candidate matches (code) ─▶ agent decides (LLM) ─▶ verifier (code) ─▶ review ─▶ apply (one transaction)
```

1. **Cleaning (code).** Deterministic. It handles:
   - encoding detection (UTF-8/16, Windows-1252)
   - delimiter sniffing, header aliases and title rows
   - Unicode dashes and spaces
   - times written without an offset, read in the theater's timezone
   - per-row validation: wrong theater, end before start, missing fields

   About 40 edge cases have unit tests.
2. **Agent (LLM).** Gemini 3 Flash runs as a tool-using agent (Vercel AI SDK). It gets each cleaned row and its likely candidates, and can call `searchSchedule` when the candidates look wrong. It finishes with `submitReview`: for every row, an action (add, update, unchanged, duplicate or skip), the showtime it matches, a confidence score, and a one-sentence reason.
3. **Verifier (code).** Every decision is checked before you see it:
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
4. **Review.**
   - Every proposed change shows the action, the change in words ("Aud 1 becomes Aud. 1, moves from 10:30 AM to 10:45 AM"), the agent's reason and its confidence. Below 75% it's marked *Check*.
   - Details show a before/after table and the raw CSV line.
   - The riskiest actions come first: updates, then archives, then new showtimes. Long lists of new showtimes collapse, with a bulk untick.
   - Changes start approved; untick the ones you doubt. Keyboard: j/k to move, Space to toggle, Cmd/Ctrl+Enter to apply.
   - Duplicates, unchanged rows and rows that couldn't be imported are listed, dimmed.
   - "How the agent decided" shows the agent's search steps and summary.
5. **Saving.** Stored with the import:
   - each row's proposal, reason, confidence and source (AI or rules)
   - your approve/reject choices
   - the agent run (model, timing, trace)
   - an append-only audit entry

   Applying runs in one transaction. It's idempotent, and it refuses a stale preview if the schedule changed after you uploaded.
6. **Fallback.** If the model errors or times out (45s budget), the rules decide every row and the page says so.

### Product decisions

- **Titles.** When a partner misspells a film ("Spiderman Homecomming"), the matched showtime keeps your title and the partner's spelling is shown as a note. A new showtime of a film you already list takes your spelling too. Auditorium renames are applied because the brief treats them as updates; you can untick any of them.
- **Prompt injection.** Cell text is untrusted data. The system prompt tells the agent never to follow it, the verifier rejects decisions the data doesn't support, and reasons that echo instructions are replaced. QA tried files whose titles told the agent to mark real showtimes as duplicates. Those rows were still decided correctly and nothing was archived wrongly.
- **Large files.** Up to about 120 rows, the agent sees every row. Above that, it sees only rows that need judgement (likely matches and near-misses). The rules settle exact matches and plainly new titles. A 5,000-row file previews in under a second. If one batch fails, the others still count and the rules fill in that batch.

## Access rules

- Each user has a role per theater: **admin** or **viewer**. A user can belong to no theaters, some or all of them. A **super admin** is admin everywhere and also manages theaters and people.
- All rules live in one file, `packages/shared/src/permissions.ts`, which both the API and the UI read.
- Viewers only receive the public fields of active showtimes. Movie status, showtime status, version and last-updated time never leave the server for them.
- Postgres row-level security enforces the same rules again. The app connects as a non-owner role (`scope_app`), and each request sets `app.user_id` inside its transaction.
- Every write lands in an append-only audit log; the app role has no UPDATE or DELETE on it. On the demo, **Reset demo data** clears it, so each reviewer starts with a clean history.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Postgres URL for the `scope_app` role (row-level security applies) |
| `MIGRATION_DATABASE_URL` | API, local/CI | Owner URL for migrations and seeding |
| `AI_MODEL` | API | Gateway model id, default `google/gemini-3-flash` |
| `AI_THINKING` / `AI_TIMEOUT_MS` | API | Gemini thinking level (default `low`) / agent time budget (default 45000) |
| `GEMINI_API_KEY` | API, optional | Call Google directly instead of the AI Gateway |
| `GEMINI_MODEL` | API, optional | Model for the direct path, default `gemini-3-flash-preview` |
| `AI_GATEWAY_API_KEY` | API, optional | Gateway key outside Vercel; on Vercel the project's own token is used |
| `DEMO_MODE` | API | `true` shows the role picker in production and enables demo reset |
| `API_URL` | Web, local only | Proxy target for the standalone API; unset on Vercel |

