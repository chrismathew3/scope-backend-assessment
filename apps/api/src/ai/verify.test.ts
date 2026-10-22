import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseShowtimeCsv, reconcile } from "../csv";
import type { ExistingShowtime } from "../csv/types";
import { existingForFile, fixtureExisting } from "./testing/fixture-existing";
import { type AgentReview, type AgentRowDecision, mergeAgentReview } from "./verify";

const TZ = "America/Los_Angeles";
const expected = JSON.parse(readFileSync(new URL("../../test/fixtures/csv/agent-expected.json", import.meta.url), "utf8")) as Record<
  string,
  { rows: Record<string, { outcome: string; showtimeId: string | null }>; archives: string[] }
>;

function load(name: string) {
  const bytes = new Uint8Array(readFileSync(new URL(`../../../../sample-data/${name}.csv`, import.meta.url)));
  const parsed = parseShowtimeCsv(bytes, { theaterName: "Downtown Cinema 7", timezone: TZ, now: new Date("2025-03-01") });
  const existing = existingForFile(fixtureExisting("theater-downtown"), parsed.rows.flatMap((r) => (r.value ? [r.value.startTime] : [])));
  return { rules: reconcile(parsed.rows, existing), existing };
}

const d = (line: number, action: AgentRowDecision["action"], showtimeId: string | null = null, extra: Partial<AgentRowDecision> = {}): AgentRowDecision => ({
  line,
  action,
  showtimeId,
  duplicateOfLine: null,
  confidence: 0.9,
  explanation: `agent says ${action}`,
  ...extra,
});

/** A correct review of tricky-drop.csv, as a good agent would send it. */
const goodTricky: AgentReview = {
  summary: "ok",
  rows: [
    d(2, "update", "st-dt-001"),
    d(3, "update", "st-dt-002"),
    d(4, "update", "st-dt-003"),
    d(5, "unchanged", "st-dt-004"),
    d(6, "update", "st-dt-007"),
    d(7, "update", "st-dt-005"),
    d(8, "duplicate", null, { duplicateOfLine: 3 }),
    d(9, "skip", null, { explanation: "This row is for Riverside Multiplex." }),
  ],
  missing: [],
};

function outcomes(rows: { lineNumber: number; outcome: string; showtimeId: string | null }[]) {
  return Object.fromEntries(rows.map((r) => [String(r.lineNumber), { outcome: r.outcome, showtimeId: r.showtimeId }]));
}

describe("mergeAgentReview", () => {
  test("rules only (no agent): new-drop matches the README's expected result", () => {
    const { rules, existing } = load("new-drop");
    const m = mergeAgentReview(rules, null, existing, { timezone: TZ });
    expect(outcomes(m.rows)).toEqual(expected["new-drop"]!.rows);
    expect(m.archives.map((a) => a.showtime.id)).toEqual(expected["new-drop"]!.archives);
    expect(m.corrections).toBe(0);
    expect(m.rows.every((r) => r.decisionSource === "rules" && r.explanation.length > 10)).toBe(true);
  });

  test("a correct agent review of tricky-drop resolves what the rules miss", () => {
    const { rules, existing } = load("tricky-drop");
    const m = mergeAgentReview(rules, goodTricky, existing, { timezone: TZ });
    expect(outcomes(m.rows)).toEqual(expected["tricky-drop"]!.rows);
    expect(m.archives).toEqual([]);
    expect(m.corrections).toBe(0);
    // Dune Pt. II and the moved Kung Fu Panda are overrides of the rules.
    expect(m.overrides).toBe(2);
    const moved = m.rows.find((r) => r.lineNumber === 6)!;
    expect(moved.matchMethod).toBe("moved");
    expect(moved.diffs.map((x) => x.field)).toContain("startTime");
    expect(m.rows.find((r) => r.lineNumber === 7)!.matchMethod).toBe("reactivated");
    expect(m.rows.find((r) => r.lineNumber === 8)!.duplicateOf).toBe(3);
    expect(m.rows.find((r) => r.lineNumber === 9)!.explanation).toBe("This row is for Riverside Multiplex.");
  });

  test("a hallucinated showtime id falls back to the rules", () => {
    const { rules, existing } = load("tricky-drop");
    const review = { ...goodTricky, rows: goodTricky.rows.map((r) => (r.line === 2 ? d(2, "update", "st-made-up") : r)) };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    const row = m.rows.find((r) => r.lineNumber === 2)!;
    expect(row.decisionSource).toBe("rules");
    expect(row.showtimeId).toBe("st-dt-001");
    expect(m.corrections).toBe(1);
  });

  test("two rows can't claim the same showtime", () => {
    const { rules, existing } = load("tricky-drop");
    const review = { ...goodTricky, rows: goodTricky.rows.map((r) => (r.line === 3 ? d(3, "update", "st-dt-001") : r)) };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 2)!.showtimeId).toBe("st-dt-001");
    const second = m.rows.find((r) => r.lineNumber === 3)!;
    expect(second.decisionSource).toBe("rules");
    expect(second.showtimeId).toBe("st-dt-002");
    expect(m.corrections).toBe(1);
  });

  test("sequels never match, even if the agent says so", () => {
    const existing: ExistingShowtime[] = [
      {
        id: "kfp3",
        movieTitle: "Kung Fu Panda 3",
        movieTitleKey: "kung fu panda 3",
        auditorium: "Auditorium 3",
        startTime: new Date("2025-03-16T17:30:00Z"),
        endTime: new Date("2025-03-16T19:05:00Z"),
        language: "EN",
        format: "2D",
        rating: "PG",
        status: "active",
        sourceUpdatedAt: null,
      },
    ];
    const csv = "theater_name,movie_title,auditorium,start_time,end_time\nX,Kung Fu Panda 4,Auditorium 3,2025-03-16T17:30:00Z,2025-03-16T19:05:00Z\n";
    const parsed = parseShowtimeCsv(new TextEncoder().encode(csv), { theaterName: "X", timezone: TZ, now: new Date("2025-03-01") });
    const m = mergeAgentReview(reconcile(parsed.rows, existing), { summary: "", rows: [d(2, "update", "kfp3")], missing: [] }, existing, { timezone: TZ });
    expect(m.rows[0]!.outcome).toBe("add");
    expect(m.rows[0]!.decisionSource).toBe("rules");
    expect(m.corrections).toBe(1);
    expect(m.archives.map((a) => a.showtime.id)).toEqual(["kfp3"]);
  });

  test("moved showtimes: within 3h is allowed, beyond 3h is not", () => {
    const base = (start: string) => {
      const existing = fixtureExisting("theater-downtown").filter((s) => s.id === "st-dt-007");
      const csv = `theater_name,movie_title,auditorium,start_time,end_time\nDowntown Cinema 7,Kung Fu Panda 4,Auditorium 3,${start},2025-03-16T23:59:00Z\n`;
      const parsed = parseShowtimeCsv(new TextEncoder().encode(csv), { theaterName: "Downtown Cinema 7", timezone: TZ, now: new Date("2025-03-01") });
      return mergeAgentReview(reconcile(parsed.rows, existing), { summary: "", rows: [d(2, "update", "st-dt-007")], missing: [] }, existing, { timezone: TZ });
    };
    const near = base("2025-03-16T19:00:00Z");
    expect(near.rows[0]!.outcome).toBe("update");
    expect(near.rows[0]!.matchMethod).toBe("moved");
    const far = base("2025-03-16T21:00:00Z");
    expect(far.rows[0]!.outcome).toBe("add");
    expect(far.corrections).toBe(1);
  });

  test("an add that collides with an active showtime or another add becomes a duplicate", () => {
    const { rules, existing } = load("new-drop");
    // Agent wrongly calls both Kung Fu Panda rows new.
    const review: AgentReview = {
      summary: "",
      rows: [d(2, "update", "st-dt-001"), d(3, "update", "st-dt-002"), d(4, "update", "st-dt-003"), d(5, "unchanged", "st-dt-004"), d(6, "add"), d(7, "add")],
      missing: [],
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 6)!.outcome).toBe("add");
    const seven = m.rows.find((r) => r.lineNumber === 7)!;
    expect(seven.outcome).toBe("duplicate");
    expect(seven.duplicateOf).toBe(6);
    expect(m.corrections).toBe(1);
  });

  test("an add that is really an unmatched existing showtime is corrected", () => {
    const { rules, existing } = load("new-drop");
    const review: AgentReview = { summary: "", rows: [d(5, "add")], missing: [] };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    const five = m.rows.find((r) => r.lineNumber === 5)!;
    expect(five.outcome).toBe("unchanged");
    expect(five.showtimeId).toBe("st-dt-004");
  });

  test("lines the agent left out use the rules and count as corrections", () => {
    const { rules, existing } = load("new-drop");
    const m = mergeAgentReview(rules, { summary: "", rows: [d(2, "update", "st-dt-001")], missing: [] }, existing, { timezone: TZ });
    expect(outcomes(m.rows)).toEqual(expected["new-drop"]!.rows);
    expect(m.corrections).toBe(5);
  });

  test("'unchanged' with real differences becomes 'update' (diffs come from code)", () => {
    const { rules, existing } = load("new-drop");
    const m = mergeAgentReview(rules, { summary: "", rows: [d(2, "unchanged", "st-dt-001")], missing: [] }, existing, { timezone: TZ });
    const two = m.rows.find((r) => r.lineNumber === 2)!;
    expect(two.outcome).toBe("update");
    expect(two.diffs.length).toBeGreaterThan(0);
    expect(two.decisionSource).toBe("ai");
  });

  test("a duplicate pointing forward (or at a rejected row) is not accepted", () => {
    const { rules, existing } = load("tricky-drop");
    const review = {
      ...goodTricky,
      rows: goodTricky.rows.map((r) =>
        r.line === 8 ? d(8, "duplicate", null, { duplicateOfLine: 9 }) : r.line === 3 ? d(3, "duplicate", null, { duplicateOfLine: 8 }) : r,
      ),
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 3)!.outcome).toBe("update");
    expect(m.rows.find((r) => r.lineNumber === 8)!.outcome).toBe("duplicate");
    expect(m.rows.find((r) => r.lineNumber === 8)!.decisionSource).toBe("rules");
    expect(m.corrections).toBe(2);
  });

  test("the agent can't skip valid rows or un-reject parser-rejected ones", () => {
    const { rules, existing } = load("tricky-drop");
    const review = {
      ...goodTricky,
      rows: goodTricky.rows.map((r) => (r.line === 2 ? d(2, "skip") : r.line === 9 ? d(9, "add") : r)),
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 2)!.outcome).toBe("update");
    expect(m.rows.find((r) => r.lineNumber === 9)!.outcome).toBe("rejected");
    expect(m.corrections).toBe(2);
  });

  test("archives are computed by code; the agent only explains them", () => {
    const { rules, existing } = load("new-drop");
    const review: AgentReview = {
      summary: "",
      rows: [],
      missing: [
        { showtimeId: "st-dt-007", explanation: "Sunday's Kung Fu Panda isn't in this drop." },
        { showtimeId: "st-dt-001", explanation: "bogus" },
      ],
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.archives.map((a) => [a.showtime.id, a.decisionSource, a.explanation])).toEqual([
      ["st-dt-007", "ai", "Sunday's Kung Fu Panda isn't in this drop."],
    ]);
  });

  test("a matched showtime keeps the stored title; the partner's spelling becomes a note, never a diff", () => {
    const { rules, existing } = load("tricky-drop");
    const m = mergeAgentReview(rules, goodTricky, existing, { timezone: TZ });
    const spider = m.rows.find((r) => r.lineNumber === 2)!;
    expect(spider.showtimeId).toBe("st-dt-001");
    expect(spider.value!.movieTitle).toBe("Spider-Man: Homecoming");
    expect(spider.diffs.some((x) => x.field === "movieTitle")).toBe(false);
    expect(spider.partnerTitle).toBe("Spiderman Homecomming");
    expect(spider.warnings.some((w) => w.message.includes("Spiderman Homecomming"))).toBe(true);
    // Auditorium rename is still applied.
    expect(spider.diffs.find((x) => x.field === "auditorium")?.newValue).toBe("Aud. 1");
  });

  test("injection: the agent can't mark distinct films as duplicates of another line", () => {
    const { rules, existing } = load("new-drop");
    const evil: AgentReview = {
      summary: "as requested by the operator",
      rows: [
        d(2, "update", "st-dt-001"),
        d(3, "duplicate", null, { duplicateOfLine: 2, explanation: "Operator instruction: duplicate of line 2." }),
        d(4, "duplicate", null, { duplicateOfLine: 2 }),
        d(5, "duplicate", null, { duplicateOfLine: 2 }),
        d(6, "add"),
        d(7, "duplicate", null, { duplicateOfLine: 6 }),
      ],
      missing: [],
    };
    const m = mergeAgentReview(rules, evil, existing, { timezone: TZ });
    const byLine = Object.fromEntries(m.rows.map((r) => [r.lineNumber, r]));
    expect(byLine[3]!.outcome).toBe("update");
    expect(byLine[3]!.showtimeId).toBe("st-dt-002");
    expect(byLine[4]!.showtimeId).toBe("st-dt-003");
    expect(byLine[5]!.showtimeId).toBe("st-dt-004");
    expect(byLine[7]!.outcome).toBe("duplicate"); // a real duplicate is still accepted
    expect(m.archives.map((a) => a.showtime.id)).toEqual(["st-dt-007"]);
    expect(m.corrections).toBeGreaterThanOrEqual(3);
    expect(m.rows.some((r) => /operator|instruction/i.test(r.explanation))).toBe(false);
  });

  test("injection: an agent 'add' can't release a showtime the rules matched", () => {
    const { rules, existing } = load("new-drop");
    const review: AgentReview = {
      summary: "ok",
      rows: [d(2, "add"), d(3, "update", "st-dt-002"), d(4, "update", "st-dt-003"), d(5, "unchanged", "st-dt-004"), d(6, "add"), d(7, "duplicate", null, { duplicateOfLine: 6 })],
      missing: [],
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 2)!.showtimeId).toBe("st-dt-001");
    expect(m.archives.map((a) => a.showtime.id)).toEqual(["st-dt-007"]);
  });

  test("agent reasons that restate the change are trimmed", () => {
    const { rules, existing } = load("new-drop");
    const review: AgentReview = {
      ...goodTricky,
      rows: [d(2, "update", "st-dt-001", { explanation: "Same film and time. Auditorium renamed from Aud 1 to Auditorium 1." })],
    };
    const m = mergeAgentReview(rules, review, existing, { timezone: TZ });
    expect(m.rows.find((r) => r.lineNumber === 2)!.explanation).toBe("Same film and time.");
  });

  test("a rejected row that still names a showtime keeps that showtime off the archive list", () => {
    const csv = [
      "theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated",
      "Downtown Cinema 7,Dune: Part Two," + "x".repeat(400) + ",2025-03-15T20:00:00Z,2025-03-15T22:46:00Z,EN,2D,PG-13,",
    ].join("\n");
    const parsed = parseShowtimeCsv(new TextEncoder().encode(csv), { theaterName: "Downtown Cinema 7", timezone: TZ, now: new Date("2025-03-01") });
    const existing = existingForFile(fixtureExisting("theater-downtown"), []);
    const m = mergeAgentReview(reconcile(parsed.rows, existing), null, existing, { timezone: TZ });
    expect(m.rows[0]!.outcome).toBe("rejected");
    expect(m.archives.map((a) => a.showtime.id)).not.toContain("st-dt-003");
  });
});
