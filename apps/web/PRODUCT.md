# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Theater schedule operators: the people at a theater or a small circuit who receive partner showtime feeds (CSV drops) every week and keep the published schedule correct. They work at a desk, between other tasks, usually on a laptop, sometimes checking from a phone. They know their own theaters, auditoriums and films well; they don't want to read CSVs line by line.

Secondary: Scope engineering reviewers evaluating the assessment. They act as these operators for a few minutes, using the seeded demo roles.

## Product Purpose

A theater management console. Operators see the schedule for the theaters they belong to, search and filter it, and change movie and showtime status. The core job: upload a partner CSV, have an LLM-backed agent compare it with the stored schedule, review its proposed actions (add, update, archive, skip duplicates) with plain-language reasons, approve or reject each one, and apply. Success: the stored schedule ends up matching the partner's intent, with no duplicate active showtimes and nothing changed without a person approving it.

## Positioning

The agent proposes and the code verifies: every AI decision is checked against the real schedule before an operator sees it. Every change is explained, scored for confidence, individually approvable, and recorded in an append-only audit trail.

## Operating Context

- Weekly or ad-hoc partner drops per theater; messy titles ("DUNE PART 2" vs "Dune: Part Two"), renamed auditoriums ("Aud 1"), duplicate rows, showtimes missing from a drop.
- Per-theater roles: admins can import and edit; viewers read active showtimes only; a super admin administers every theater and manages people.
- Times are shown in each theater's own timezone.
- Reviewers sign in through a one-click role picker (demo accounts).

## Capabilities and Constraints

- Next.js 15 + React 19 + Tailwind v4 web app; Hono/tRPC API; Postgres.
- Showtime fields: theater, movie title, movie status (approved, draft, flagged, needs-review), auditorium, start/end, language, format, rating, showtime status (active, inactive, archived), last updated.
- Import outcomes: add, update, unchanged, duplicate, rejected, archive (missing from drop).
- Search, filters and sorting must stay fast at hundreds of thousands of rows.
- The role picker stays (decided by the owner).

## Brand Commitments

- Visual register: hyper-minimal, Linear / Vercel / Superhuman calibre. Practical, quiet, calm; simple and easy to read; typography and layout carry the design, not color or decoration (owner, 2026-10-22).
- Owner's standing bans: no eyebrow labels, no monospace meta bylines, no numbered rows, no decorative arrow glyphs, no gradients, no glassmorphism, no serif + italic accent, no decorative pill chips.

## Evidence on Hand

- Seeded demo data: 3 theaters (Downtown Cinema 7 Seattle, Riverside Multiplex Portland, Uptown Arts Theater San Francisco), 15 showtimes, 7 users across roles.
- Sample partner CSVs in `sample-data/`.
- No real customers, testimonials or metrics exist; never invent them.

## Product Principles

1. Nothing changes without a person approving it; every proposed change says why.
2. Show the agent's reasoning, not just its answer; confidence is visible, and low confidence is obvious.
3. The schedule is the source of truth; the AI is a reviewer's assistant, never an authority.
4. Scope is always clear: which theater, which role, what you can and can't do here.
5. Fast, dense and familiar for daily use; delight is saved for the import review.

## Accessibility & Inclusion

WCAG 2.1 AA: keyboard-operable review flow, visible focus, color never the only signal for add/update/archive, readable at phone width.
