import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { titleKey } from "./normalize";
import { parseShowtimeCsv, type ParseOptions } from "./parse";
import { reconcile } from "./reconcile";
import type { ExistingShowtime, ShowtimeStatus } from "./types";

const ROOT = join(import.meta.dir, "../../../..");
const OPTS: ParseOptions = {
  theaterName: "Downtown Cinema 7",
  timezone: "America/Los_Angeles",
  now: new Date("2025-03-01T00:00:00Z"),
};
const HEADER = "theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated";

function existing(
  id: string,
  movieTitle: string,
  auditorium: string,
  start: string,
  end: string,
  extra: Partial<ExistingShowtime> & { status?: ShowtimeStatus } = {},
): ExistingShowtime {
  return {
    id,
    movieTitle,
    movieTitleKey: titleKey(movieTitle),
    auditorium,
    startTime: new Date(start),
    endTime: new Date(end),
    language: "EN",
    format: "2D",
    rating: "PG",
    status: "active",
    sourceUpdatedAt: null,
    ...extra,
  };
}

// Downtown showtimes from apps/web/src/data/assessment-data.ts
const DOWNTOWN: ExistingShowtime[] = [
  existing("st-dt-001", "Spider-Man: Homecoming", "Auditorium 1", "2025-03-15T18:00:00Z", "2025-03-15T20:13:00Z", { rating: "PG-13", sourceUpdatedAt: new Date("2025-03-10T12:00:00Z") }),
  existing("st-dt-002", "Inside Out 2", "Auditorium 2", "2025-03-15T17:30:00Z", "2025-03-15T19:20:00Z", { format: "3D", sourceUpdatedAt: new Date("2025-03-10T12:00:00Z") }),
  existing("st-dt-003", "Dune: Part Two", "Auditorium 1", "2025-03-15T20:00:00Z", "2025-03-15T22:46:00Z", { format: "IMAX", rating: "PG-13", sourceUpdatedAt: new Date("2025-03-12T15:30:00Z") }),
  existing("st-dt-004", "Dune: Part Two", "Auditorium 1", "2025-03-15T22:45:00Z", "2025-03-16T01:31:00Z", { rating: "PG-13", sourceUpdatedAt: new Date("2025-03-12T15:30:00Z") }),
  existing("st-dt-005", "Wonka", "Auditorium 3", "2025-03-15T16:00:00Z", "2025-03-15T17:56:00Z", { status: "archived" }),
  existing("st-dt-006", "Oppenheimer", "Auditorium 4", "2025-03-15T21:00:00Z", "2025-03-16T00:00:00Z", { format: "IMAX", rating: "R", status: "archived" }),
  existing("st-dt-007", "Kung Fu Panda 4", "Auditorium 3", "2025-03-16T17:30:00Z", "2025-03-16T19:05:00Z", { sourceUpdatedAt: new Date("2025-03-14T11:00:00Z") }),
];

function run(rows: string[], current: ExistingShowtime[] = DOWNTOWN) {
  const parsed = parseShowtimeCsv(new TextEncoder().encode([HEADER, ...rows].join("\n")), OPTS);
  return reconcile(parsed.rows, current);
}

describe("sample-data/new-drop.csv against the seeded Downtown schedule", () => {
  const bytes = new Uint8Array(readFileSync(join(ROOT, "sample-data/new-drop.csv")));
  const parsed = parseShowtimeCsv(bytes, OPTS);
  const result = reconcile(parsed.rows, DOWNTOWN);
  const forShowtime = (id: string) => result.rows.find((r) => r.showtimeId === id)!;
  const diffMap = (id: string) => Object.fromEntries(forShowtime(id).diffs.map((d) => [d.field, d.newValue]));

  test("file parses with no notices and no rejected rows", () => {
    expect(parsed.notices).toEqual([]);
    expect(parsed.rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  test("st-dt-001: auditorium rename + title spelling = update", () => {
    expect(forShowtime("st-dt-001").outcome).toBe("update");
    expect(diffMap("st-dt-001")).toEqual({ movieTitle: "Spider Man - Homecoming", auditorium: "Aud 1" });
  });

  test("st-dt-002: auditorium rename = update; extra spaces cleaned so title is unchanged", () => {
    expect(forShowtime("st-dt-002").outcome).toBe("update");
    expect(diffMap("st-dt-002")).toEqual({ auditorium: "Auditorium Two" });
    expect(forShowtime("st-dt-002").value?.movieTitle).toBe("Inside Out 2");
  });

  test("st-dt-003: DUNE PART 2 matches Dune: Part Two; no format diff (JSON already says IMAX)", () => {
    expect(forShowtime("st-dt-003").outcome).toBe("update");
    expect(forShowtime("st-dt-003").matchMethod).toBe("exact_key");
    expect(diffMap("st-dt-003")).toEqual({ movieTitle: "DUNE PART 2", auditorium: "Auditorium 1 (Laser)" });
  });

  test("st-dt-004: trailing spaces only = unchanged", () => {
    expect(forShowtime("st-dt-004").outcome).toBe("unchanged");
  });

  test("Kung Fu Panda 4 at 18:30 in Auditorium 5 is one add plus one duplicate", () => {
    const adds = result.rows.filter((r) => r.outcome === "add");
    expect(adds).toHaveLength(1);
    expect(adds[0]!.value?.movieTitle).toBe("Kung Fu Panda 4");
    expect(adds[0]!.value?.auditorium).toBe("Auditorium 5");
    expect(adds[0]!.value?.startTime.toISOString()).toBe("2025-03-15T18:30:00.000Z");
    const dupes = result.rows.filter((r) => r.outcome === "duplicate");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.warnings[0]!.message).toContain(`Duplicate of line ${adds[0]!.lineNumber}`);
  });

  test("only st-dt-007 is archived (005 and 006 already are)", () => {
    expect(result.archives.map((a) => a.id)).toEqual(["st-dt-007"]);
    expect(result.counts).toEqual({ add: 1, update: 3, unchanged: 1, duplicate: 1, rejected: 0, archive: 1 });
  });
});

describe("sample-data/existing.csv", () => {
  test("parses cleanly; the non-breaking hyphen becomes a plain one", () => {
    const parsed = parseShowtimeCsv(new Uint8Array(readFileSync(join(ROOT, "sample-data/existing.csv"))), OPTS);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Spider-Man: Homecoming");
    expect(parsed.rows[0]!.value?.movieTitleKey).toBe("spider man homecoming");
  });
});

describe("matching rules", () => {
  const base = [existing("a", "Kung Fu Panda 3", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T19:40:00Z")];

  test("M1 fuzzy title at the same start time", () => {
    const current = [existing("s", "Spider-Man: Homecoming", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T20:13:00Z")];
    const r = run(["Downtown Cinema 7,Spiderman Homecoming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,"], current);
    expect(r.rows[0]!.matchMethod).toBe("fuzzy_title");
    expect(r.rows[0]!.showtimeId).toBe("s");
    expect(r.archives).toEqual([]);
  });

  test("M3 sequels never fuzzy-match each other", () => {
    const r = run(["Downtown Cinema 7,Kung Fu Panda 4,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T19:40:00Z,EN,2D,PG,"], base);
    expect(r.rows[0]!.outcome).toBe("add");
    expect(r.archives.map((a) => a.id)).toEqual(["a"]);
  });

  test("M4 same movie and start in two auditoriums: first wins, second is a flagged duplicate", () => {
    const r = run(
      [
        "Downtown Cinema 7,Wonka,Auditorium 3,2025-03-20T16:00:00Z,2025-03-20T17:56:00Z,EN,2D,PG,",
        "Downtown Cinema 7,Wonka,Auditorium 4,2025-03-20T16:00:00Z,2025-03-20T17:56:00Z,EN,2D,PG,",
      ],
      [],
    );
    expect(r.rows.map((x) => x.outcome)).toEqual(["add", "duplicate"]);
    expect(r.rows[1]!.warnings[0]!.message).toContain("different auditorium");
  });

  test("M5 a showtime moved by 15 minutes is add + archive (no guessing by proximity)", () => {
    const r = run(["Downtown Cinema 7,Kung Fu Panda 3,Auditorium 1,2025-03-20T18:15:00Z,2025-03-20T19:55:00Z,EN,2D,PG,"], base);
    expect(r.rows[0]!.outcome).toBe("add");
    expect(r.archives.map((a) => a.id)).toEqual(["a"]);
  });

  test("M6 fuzzy tie is not a match", () => {
    const current = [
      existing("x", "Spider Man Homecoming A", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T20:00:00Z"),
      existing("y", "Spider Man Homecoming B", "Auditorium 2", "2025-03-20T18:00:00Z", "2025-03-20T20:00:00Z"),
    ];
    const r = run(["Downtown Cinema 7,Spider Man Homecoming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:00:00Z,EN,2D,PG,"], current);
    expect(r.rows[0]!.outcome).toBe("add");
    expect(r.rows[0]!.warnings[0]!.message).toContain("Could be any of");
  });

  test("M7 an archived showtime that comes back is reactivated", () => {
    const r = run(["Downtown Cinema 7,Wonka,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,"]);
    const row = r.rows[0]!;
    expect(row.outcome).toBe("update");
    expect(row.matchMethod).toBe("reactivated");
    expect(row.showtimeId).toBe("st-dt-005");
    expect(row.diffs).toEqual([{ field: "status", oldValue: "archived", newValue: "active" }]);
  });

  test("M8 inactive showtime: matched without a status diff; archived if missing", () => {
    const current = [
      existing("i1", "Wonka", "Auditorium 3", "2025-03-20T16:00:00Z", "2025-03-20T17:56:00Z", { status: "inactive" }),
      existing("i2", "Civil War", "Auditorium 3", "2025-03-20T20:00:00Z", "2025-03-20T22:00:00Z", { status: "inactive" }),
    ];
    const r = run(["Downtown Cinema 7,Wonka,Auditorium 3,2025-03-20T16:00:00Z,2025-03-20T17:56:00Z,EN,2D,PG,"], current);
    expect(r.rows[0]!.outcome).toBe("unchanged");
    expect(r.archives.map((a) => a.id)).toEqual(["i2"]);
  });

  test("exact matches win over fuzzy guesses regardless of row order", () => {
    const current = [existing("s", "Spider-Man: Homecoming", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T20:13:00Z")];
    const r = run(
      [
        "Downtown Cinema 7,Spiderman Homecoming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,",
        "Downtown Cinema 7,Spider-Man: Homecoming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,",
      ],
      current,
    );
    expect(r.rows[1]!.matchMethod).toBe("exact_key");
    // The typo row is the same showtime, so it's a duplicate, never a second active copy.
    expect(r.rows[0]!.outcome).toBe("duplicate");
    expect(r.rows[0]!.duplicateOf).toBe(3);
  });

  test("P0 a different subtitle is a different film, even with similar titles", () => {
    const current = [existing("into", "Spider-Man: Into the Spider-Verse", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T20:00:00Z")];
    const r = run(["Downtown Cinema 7,Spider-Man: Across the Spider-Verse,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:00:00Z,EN,2D,PG,"], current);
    expect(r.rows[0]!.outcome).toBe("add");
    expect(r.archives.map((a) => a.id)).toEqual(["into"]);
  });

  test("P0 typos and joined words still match", () => {
    const current = [existing("s", "Spider-Man: Homecoming", "Auditorium 1", "2025-03-20T18:00:00Z", "2025-03-20T20:13:00Z")];
    const r = run(["Downtown Cinema 7,Spiderman Homecomming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,"], current);
    expect(r.rows[0]!.showtimeId).toBe("s");
    expect(r.rows[0]!.matchMethod).toBe("fuzzy_title");
  });

  test("P0 two spellings of one new film at one start: one add, one duplicate", () => {
    const r = run(
      [
        "Downtown Cinema 7,Spiderman Homecoming,Auditorium 1,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,",
        "Downtown Cinema 7,Spider-Man: Homecoming,Auditorium 2,2025-03-20T18:00:00Z,2025-03-20T20:13:00Z,EN,2D,PG,",
      ],
      [],
    );
    expect(r.rows.map((x) => x.outcome)).toEqual(["add", "duplicate"]);
    expect(r.rows[1]!.duplicateOf).toBe(2);
    expect(r.rows[1]!.warnings[0]!.message).toContain('Same film and start time as line 2 ("Spiderman Homecoming")');
  });

  test("duplicates keep the row with the newer last_updated", () => {
    const r = run(
      [
        "Downtown Cinema 7,Wonka,Auditorium 3,2025-03-20T16:00:00Z,2025-03-20T17:56:00Z,EN,2D,PG,2025-03-10T00:00:00Z",
        "Downtown Cinema 7,Wonka,Auditorium 4,2025-03-20T16:00:00Z,2025-03-20T17:56:00Z,EN,2D,PG,2025-03-12T00:00:00Z",
      ],
      [],
    );
    expect(r.rows.map((x) => x.outcome)).toEqual(["duplicate", "add"]);
    expect(r.rows[0]!.duplicateOf).toBe(3);
    expect(r.rows[0]!.warnings[0]!.message).toBe("Same movie and start time as line 3 but different auditorium; kept line 3 (it has the newer last_updated).");
  });

  test("V8 feed older than stored data warns but still applies", () => {
    const r = run(["Downtown Cinema 7,Kung Fu Panda 4,Auditorium 9,2025-03-16T17:30:00Z,2025-03-16T19:05:00Z,EN,2D,PG,2025-03-01T00:00:00Z"]);
    const row = r.rows[0]!;
    expect(row.outcome).toBe("update");
    expect(row.warnings.map((w) => w.message)).toContain("Feed data is older than what is stored.");
  });

  test("rejected rows never match or archive-protect anything", () => {
    const r = run([
      "Downtown Cinema 7,Kung Fu Panda 4,Auditorium 3,2025-03-16T17:30:00Z,not a time,EN,2D,PG,",
      "Downtown Cinema 7,Wonka,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,", // a file needs one valid row
    ]);
    expect(r.rows[0]!.outcome).toBe("rejected");
    expect(r.archives.map((a) => a.id)).toContain("st-dt-007");
  });
});

describe("no-optional-columns.csv: a file without format, rating or language columns", () => {
  const bytes = new Uint8Array(readFileSync(join(import.meta.dir, "../../test/fixtures/csv/no-optional-columns.csv")));
  const parsed = parseShowtimeCsv(bytes, OPTS);
  const result = reconcile(parsed.rows, DOWNTOWN);

  test("stored values are kept: same times and auditoriums are unchanged, not IMAX -> 2D or PG-13 -> NR", () => {
    expect(result.rows.map((r) => r.outcome)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(result.rows.every((r) => r.diffs.length === 0)).toBe(true);
    expect(parsed.notices).toContain("No rating column: stored ratings are kept; new showtimes get NR.");
  });

  test("a real change in a column the file does have is still an update", () => {
    const text = new TextDecoder().decode(bytes).replace("Downtown Cinema 7,Auditorium 2", "Downtown Cinema 7,Aud 9");
    const r = reconcile(parseShowtimeCsv(new TextEncoder().encode(text), OPTS).rows, DOWNTOWN);
    expect(r.rows[1]!.diffs).toEqual([{ field: "auditorium", oldValue: "Auditorium 2", newValue: "Aud 9" }]);
  });

  test("adds still get the defaults", () => {
    const text = `${new TextDecoder().decode(bytes).trimEnd()}\n2025-03-20T18:00:00Z,Wonka,Downtown Cinema 7,Auditorium 3,2025-03-20T20:00:00Z,,\n`;
    const r = reconcile(parseShowtimeCsv(new TextEncoder().encode(text), OPTS).rows, DOWNTOWN);
    const add = r.rows.at(-1)!;
    expect(add.outcome).toBe("add");
    expect([add.value!.format, add.value!.rating, add.value!.language]).toEqual(["2D", "NR", "EN"]);
  });
});
