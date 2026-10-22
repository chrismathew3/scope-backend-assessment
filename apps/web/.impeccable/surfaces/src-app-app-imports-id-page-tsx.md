---
version: 1
slug: "src-app-app-imports-id-page-tsx"
primary_target: "src/app/(app)/imports/[id]/page.tsx"
related_targets: ["src/app/(app)/page.tsx","src/app/login/page.tsx"]
---

# Surface: import review (and the console that hosts it)

Scope: Operate mode. The AI import review is the primary surface; showtimes, people, audit, sign-in inherit its system.
Audience: theater schedule operators (and Scope reviewers acting as them). Job: upload a partner CSV, read the agent's proposed actions with reasons, approve or reject each, apply.
Approved comp: .impeccable/mocks/comp-focus.png (seed e7927052, canon chosen, Superhuman-style focus composition).

## Direction contract

THESIS: A review you can read in ten seconds: one calm column where each proposed change is one sentence of action plus one sentence of why. It refuses the side-sheet-over-a-table admin default and every badge, chip and colored status pill.

OWN-WORLD: White ground, near-black ink, two greys, hairline rules; Inter at a tight scale (34 / 15 / 13); black primary button; color appears only as a small dot or word for risk (amber low confidence, red archive). Recognizable with content removed: a centered 640px column of ruled two-line rows with round-corner checkboxes and right-aligned percentages.

STORY: The operator understands what the partner changed and why the agent thinks so, trusts it because every line is checkable, unticks anything doubtful, presses Apply, and sees the schedule updated with an audit trail.

FIRST VIEWPORT: Slim top line (theater left, user right, nav centered-quiet). Large title "Review <file>", grey one-sentence agent summary, then the list of changes; sticky footer with keyboard hint left, black "Apply N changes" and a plain "Discard" link right. Signature interaction: keyboard review (j/k to move, space to toggle, enter to apply) with rows that expand inline to show before/after and the raw CSV line.

FORM: category standard (canon) at full craft, hyper-minimal Linear / Vercel / Superhuman register; position: canon exit chosen by the owner after the safer re-roll; seed key e7927052. Type: owner-pinned register overrides the metric ranker's display face; Inter carries every role at the comp's measured cap heights.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Review record

- 2026-10-22: hero gate reached 76% overall; after three attempts the owner reviewed the live first viewport in the browser and accepted it as the direction ("Accept, keep going"). Remaining hero readings are advisories.
- Stated departures from the comp: changes start approved (operator unticks doubts); a chevron opens per-row details; agent attribution appears only on matches the rules would miss.
