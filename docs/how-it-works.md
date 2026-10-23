# How it works

## An import, step by step

```
CSV → clean (code) → find candidates (code) → decide (LLM) → verify (code) → you review → apply (one transaction)
```

**1. Clean.** The parser detects the encoding (UTF-8, UTF-16, Windows-1252) and the delimiter, maps header aliases, skips title rows, and normalizes dashes and spaces. Times without an offset are read in the theater's timezone. Rows for the wrong theater, with the end before the start, or with missing fields are rejected with a plain reason.

- A rejected row that still names a film keeps that film off the archive list.
- A file is refused if it's over 3 MB or 5,000 rows. So is a file with no importable row, which would otherwise archive the whole schedule.
- If the file has no language, format or rating column, stored values are kept; only new showtimes get defaults.

**2. Find candidates.** For each row, code finds stored showtimes it could be: same normalized title and start, a close spelling, or the same film moved by a few minutes.

**3. Decide.** Gemini 3 Flash gets each row and its candidates. When the schedule is too big to inline it can call `searchSchedule`, and it answers through `submitReview` with an action (add, update, unchanged, duplicate), the matched showtime, a confidence and a one-sentence reason. Rejected rows and duplicates the rules found are never sent. Files up to 120 rows go to the agent in full. Larger files only send rows a verified match could change; exact matches and titles with no plausible stored match are settled by rules. A 5,000-row file of new titles previews in about 3 seconds, locally and on the hosted demo. No database transaction is open while the model runs.

**4. Verify.** Code checks every decision:

- The match is a real showtime in this theater, and no showtime is claimed twice.
- A moved showtime keeps the same film and moves less than 3 hours.
- Sequels don't match (Kung Fu Panda 3 is not Kung Fu Panda 4), and neither do different subtitles: each title having a word the other lacks ("Across" / "Into the Spider-Verse") means different films.
- Same-title, same-start matches claim their showtime first, across the whole file; the agent can't move them or undo a match the rules were sure of.
- A duplicate really repeats the row it points at, and no add becomes a second active copy of a film at the same start.
- A match whose title differs from the stored one is always shown as an update with the drop's spelling, never a silent "unchanged".
- The agent's reason is shown only if it is short, has no instruction-like text, and doesn't claim "identical" when the text differs; otherwise code writes it.

Anything that fails falls back to the rule-based answer and counts as a correction. Field diffs, the archive list and its reasons, and the drop's summary are always written by code.

**5. Review.** Updates come first, then archives, then new showtimes. Each shows what changes ("Aud 1 becomes Aud. 1, moves from 10:30 AM to 10:45 AM"), the reason and the confidence; below 75% it's marked Check. Everything starts approved. Keyboard: j/k to move, Space to toggle, Cmd/Ctrl+Enter to apply.

**6. Apply.** One transaction. Applying twice does nothing the second time, and a preview goes stale if anyone changed the schedule after the upload. The import keeps each row's proposal, reason, confidence, source (AI or rules), your decision, and the agent's trace.

If the model fails or runs past its 45-second budget, the rules decide every row and the review page says so.

## Prompt injection

Cell text is data. The system prompt says so, the verifier rejects decisions the data doesn't support, and reasons that echo instructions are replaced. In testing, files with titles telling the agent to mark real showtimes as duplicates were still decided correctly and archived nothing they shouldn't.

## Access

- Each user is an admin or a viewer per theater, in none, some or all theaters. A super admin is admin everywhere and manages theaters and people.
- The rules live in `packages/shared/src/permissions.ts`, which the API and the UI both use.
- Viewers get active showtimes only, without movie status, showtime status, version or last-updated time.
- Postgres row-level security enforces the same rules on showtimes and imports, the data viewers can reach. The app connects as a non-owner role (`scope_app`) and sets `app.user_id` in each request's transaction. People, memberships and the audit log are checked in code.
- Every write goes to an audit log the app role can't update or delete. The one exception is the demo: there, and only when `DEMO_MODE` is on at migration time, the app may call a reset function that clears it so each reviewer starts clean.
- Each account can upload 30 files per 10 minutes, since every upload calls a paid model.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Postgres URL for the `scope_app` role |
| `MIGRATION_DATABASE_URL` | API, local | Owner URL for migrations and seeding |
| `GEMINI_API_KEY` | API, optional | Call Gemini directly |
| `GEMINI_MODEL` | API, optional | Model for that path, default `gemini-3-flash-preview` |
| `AI_GATEWAY_API_KEY` | API, optional | Use Vercel AI Gateway outside Vercel (on Vercel it authenticates itself) |
| `AI_MODEL` | API | Gateway model, default `google/gemini-3-flash` |
| `AI_THINKING`, `AI_TIMEOUT_MS` | API | Thinking level (default `low`) and agent budget (default 45000 ms) |
| `DEMO_MODE` | API | `true` shows the role picker in production and allows demo reset |
| `API_URL` | Web, local | Where the web app proxies API calls; unset on Vercel |
