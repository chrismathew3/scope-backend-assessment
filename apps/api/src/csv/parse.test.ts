import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CsvFileError, parseShowtimeCsv, type ParseOptions } from "./parse";

const FIXTURES = join(import.meta.dir, "../../test/fixtures/csv");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const bytes = (text: string) => new TextEncoder().encode(text);

const OPTS: ParseOptions = {
  theaterName: "Downtown Cinema 7",
  timezone: "America/Los_Angeles",
  now: new Date("2025-01-01T00:00:00Z"),
};

const HEADER = "theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated";
const ROW = "Downtown Cinema 7,Wonka,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,2025-03-10T12:00:00Z";

function fileError(fn: () => unknown): CsvFileError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CsvFileError) return e;
    throw e;
  }
  throw new Error("expected CsvFileError");
}

/** Parse a single data row under the standard header and return it. */
function oneRow(row: string, opts: Partial<ParseOptions> = {}) {
  const parsed = parseShowtimeCsv(bytes(`${HEADER}\n${row}\n`), { ...OPTS, ...opts });
  expect(parsed.rows).toHaveLength(1);
  return parsed.rows[0]!;
}

describe("file level", () => {
  test("F1 empty file and whitespace-only file", () => {
    expect(fileError(() => parseShowtimeCsv(new Uint8Array(), OPTS)).code).toBe("empty");
    expect(fileError(() => parseShowtimeCsv(bytes(" \n\n  \n"), OPTS)).code).toBe("empty");
  });

  test("F1 header only refuses to archive everything", () => {
    const e = fileError(() => parseShowtimeCsv(fixture("header-only.csv"), OPTS));
    expect(e.code).toBe("header_only");
    expect(e.message).toContain("Clear Schedule");
  });

  test("F2 binary and Excel files", () => {
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    expect(fileError(() => parseShowtimeCsv(xlsx, OPTS)).message).toContain("Excel");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(fileError(() => parseShowtimeCsv(png, OPTS)).code).toBe("not_csv");
  });

  test("F4 UTF-8 BOM is stripped", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(`${HEADER}\n${ROW}\n`)]);
    const parsed = parseShowtimeCsv(withBom, OPTS);
    expect(parsed.notices).toEqual([]);
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Wonka");
  });

  test("F4 UTF-16 LE with BOM", () => {
    const text = `${HEADER}\n${ROW.replace("Wonka", "Amélie")}\n`;
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      utf16[2 + i * 2] = code & 0xff;
      utf16[3 + i * 2] = code >> 8;
    }
    const parsed = parseShowtimeCsv(utf16, OPTS);
    expect(parsed.notices.join(" ")).toContain("UTF-16");
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Amélie");
  });

  test("F4 Windows-1252 falls back with a notice", () => {
    // "Amélie" in Windows-1252: é = 0xE9 (invalid as UTF-8 here)
    const head = bytes(`${HEADER}\nDowntown Cinema 7,Am`);
    const tail = bytes(`lie,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,\n`);
    const parsed = parseShowtimeCsv(new Uint8Array([...head, 0xe9, ...tail]), OPTS);
    expect(parsed.notices.join(" ")).toContain("Windows-1252");
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Amélie");
  });

  test("F5 semicolon delimiter and H2 header aliases", () => {
    const parsed = parseShowtimeCsv(fixture("semicolon-aliases.csv"), OPTS);
    expect(parsed.notices.join(" ")).toContain("semicolons");
    const v = parsed.rows[0]!.value!;
    expect(v.lastUpdated).toBeNull(); // optional column, absent without a notice
    expect(v.auditorium).toBe("Aud 3");
    expect(v.auditoriumKey).toBe("auditorium 3");
    expect(v.language).toBe("EN");
    expect(v.format).toBe("3D");
    expect(v.rating).toBe("PG-13");
  });

  test("F5 tab delimiter", () => {
    const tsv = `${HEADER.replaceAll(",", "\t")}\n${ROW.replaceAll(",", "\t")}\n`;
    const parsed = parseShowtimeCsv(bytes(tsv), OPTS);
    expect(parsed.notices.join(" ")).toContain("tabs");
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Wonka");
  });

  test("F6 CR-only line endings", () => {
    const parsed = parseShowtimeCsv(bytes(`${HEADER}\r${ROW}\r${ROW.replace("16:00", "19:00").replace("17:56", "20:56")}\r`), OPTS);
    expect(parsed.rows.map((r) => r.lineNumber)).toEqual([2, 3]);
  });

  test("F7 unbalanced quote names a line", () => {
    const e = fileError(() => parseShowtimeCsv(fixture("unbalanced-quote.csv"), OPTS));
    expect(e.code).toBe("unbalanced_quotes");
    expect(e.message).toMatch(/line \d+/);
  });

  test("F11 every row is for another theater", () => {
    const e = fileError(() => parseShowtimeCsv(fixture("other-theater.csv"), OPTS));
    expect(e.code).toBe("wrong_theater");
    expect(e.message).toContain("Riverside Multiplex");
    expect(e.message).toContain("Downtown Cinema 7");
  });
});

describe("header", () => {
  test("H1 reordered columns, H4 extra columns ignored, optional columns defaulted", () => {
    const parsed = parseShowtimeCsv(fixture("reordered-extra-columns.csv"), OPTS);
    const notes = parsed.notices.join(" ");
    expect(notes).toContain("Ignored columns: Notes");
    expect(notes).toContain('No language column; every row uses "EN"');
    expect(notes).toContain('No format column; every row uses "2D"');
    const v = parsed.rows[0]!.value!;
    expect(v.movieTitle).toBe("Wonka");
    expect(v.theaterName).toBe("downtown cinema 7"); // R4: case/space-insensitive theater match
    expect(v.language).toBe("EN");
    expect(v.format).toBe("2D");
  });

  test("H3 missing required column lists what is missing and what was found", () => {
    const e = fileError(() =>
      parseShowtimeCsv(bytes("theater_name,movie_title,start_time,language\nDowntown Cinema 7,Wonka,2025-03-15T16:00:00Z,EN\n"), OPTS),
    );
    expect(e.code).toBe("missing_columns");
    expect(e.message).toContain("auditorium, end_time");
    expect(e.message).toContain("Found: theater_name, movie_title, start_time, language");
  });

  test("H3 no recognisable header at all", () => {
    const e = fileError(() => parseShowtimeCsv(bytes("a,b,c\n1,2,3\n"), OPTS));
    expect(e.code).toBe("missing_columns");
  });

  test("H5 duplicate header names and two aliases for one column", () => {
    expect(fileError(() => parseShowtimeCsv(bytes(`${HEADER},rating\n${ROW},PG\n`), OPTS)).code).toBe(
      "duplicate_header",
    );
    // Two equally good names for one column are ambiguous.
    const e = fileError(() => parseShowtimeCsv(bytes(`${HEADER},Movie Title\n${ROW},Wonka\n`), OPTS));
    expect(e.code).toBe("duplicate_header");
    expect(e.message).toContain("movie_title");
  });

  test("H5 the canonical header wins over an alias for the same column; the alias is ignored with a notice", () => {
    const parsed = parseShowtimeCsv(bytes(`${HEADER},film,location\n${ROW},Something Else,Main St\n`), OPTS);
    expect(parsed.rows[0]!.errors).toEqual([]);
    expect(parsed.rows[0]!.value?.movieTitle).not.toBe("Something Else");
    expect(parsed.notices).toContain('Ignored the "film" column: "movie_title" is used for movie_title.');
    expect(parsed.notices).toContain('Ignored the "location" column: "theater_name" is used for theater_name.');
  });

  test("H5 between two aliases, the closer name wins", () => {
    const parsed = parseShowtimeCsv(
      bytes("theater,location,title,name,auditorium,start_time,end_time\nDowntown Cinema 7,Main St,Wonka,Other,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z\n"),
      OPTS,
    );
    expect(parsed.rows[0]!.value?.theaterName).toBe("Downtown Cinema 7");
    expect(parsed.rows[0]!.value?.movieTitle).toBe("Wonka");
  });

  test("H5 empty header name is refused, but a trailing comma is tolerated", () => {
    expect(fileError(() => parseShowtimeCsv(bytes(`theater_name,,movie_title,auditorium,start_time,end_time\nx,y,z,a,b,c\n`), OPTS)).code).toBe(
      "empty_header",
    );
    const parsed = parseShowtimeCsv(bytes(`${HEADER},\n${ROW},\n`), OPTS);
    expect(parsed.rows[0]!.errors).toEqual([]);
  });

  test("H6 title rows above the header are skipped", () => {
    const parsed = parseShowtimeCsv(fixture("title-rows.csv"), OPTS);
    expect(parsed.headerLine).toBe(3);
    expect(parsed.notices.join(" ")).toContain("Skipped 2 title rows");
    expect(parsed.rows[0]!.lineNumber).toBe(4);
  });
});

describe("rows (messy-rows.csv)", () => {
  const parsed = parseShowtimeCsv(fixture("messy-rows.csv"), OPTS);
  const byLine = new Map(parsed.rows.map((r) => [r.lineNumber, r]));

  test("R1 blank and whitespace-only rows are skipped; line numbers stay physical", () => {
    expect(parsed.rows.map((r) => r.lineNumber)).toEqual([2, 5, 7, 8, 9, 10, 11]);
  });

  test("quoted commas and quoted newlines", () => {
    expect(byLine.get(2)!.value?.movieTitle).toBe("Wonka, the Musical");
    expect(byLine.get(5)!.value?.movieTitle).toBe("Two Lines");
  });

  test("R2 ragged rows", () => {
    expect(byLine.get(7)!.errors[0]!.message).toContain("missing-cell");
    expect(byLine.get(7)!.value).toBeNull();
    expect(byLine.get(8)!.errors[0]!.message).toContain("extra-cell");
    expect(byLine.get(8)!.raw["(extra 1)"]).toBe("surprise");
  });

  test("R4 row for another theater is rejected, file still parses", () => {
    expect(byLine.get(9)!.errors[0]!.message).toContain('Row is for theater "Riverside Multiplex"');
  });

  test("R5 formula injection is flagged, value kept as text", () => {
    const row = byLine.get(10)!;
    expect(row.value?.movieTitle).toBe('=HYPERLINK("x")');
    expect(row.warnings[0]!.message).toContain("formula");
  });

  test("R5 the OWASP formula characters -, tab and CR are flagged too", () => {
    for (const title of ["-2+3", "\t=1+1", "@SUM(A1)", "+1"]) {
      const parsed = parseShowtimeCsv(bytes(`${HEADER}\n${ROW.replace("Wonka", `"${title}"`)}\n`), OPTS);
      expect(parsed.rows[0]!.warnings.map((w) => w.message)).toContain("Starts with a spreadsheet formula character; stored as plain text.");
    }
    const plain = parseShowtimeCsv(bytes(`${HEADER}\n${ROW}\n`), OPTS);
    expect(plain.rows[0]!.warnings).toEqual([]);
  });

  test("R3 required value empty", () => {
    expect(byLine.get(11)!.errors).toEqual([{ column: "movie_title", message: "Required." }]);
  });
});

describe("row values", () => {
  test("R6 overlong value", () => {
    const row = oneRow(ROW.replace("Wonka", "W".repeat(301)));
    expect(row.errors[0]!.message).toContain("300");
  });

  test("R7 zero-width and NBSP characters are cleaned", () => {
    const row = oneRow(ROW.replace("Wonka", "Won​ka  "));
    expect(row.value?.movieTitle).toBe("Wonka");
  });

  test("punctuation-only title has no key", () => {
    expect(oneRow(ROW.replace("Wonka", "!!!")).errors[0]!.message).toContain("no letters or digits");
  });

  test("V1 explicit offsets are honored", () => {
    const row = oneRow(ROW.replace("2025-03-15T16:00:00Z", "2025-03-15T09:00:00-07:00"));
    expect(row.value?.startTime.toISOString()).toBe("2025-03-15T16:00:00.000Z");
    const compact = oneRow(ROW.replace("2025-03-15T16:00:00Z", "2025-03-15T09:00:00-0700"));
    expect(compact.value?.startTime.toISOString()).toBe("2025-03-15T16:00:00.000Z");
  });

  test("V2 naive times use the theater timezone", () => {
    const row = oneRow(
      ROW.replace("2025-03-15T16:00:00Z", "2025-03-15 09:00").replace("2025-03-15T17:56:00Z", "2025-03-15T10:56:00"),
    );
    // Los Angeles is UTC-7 on March 15 2025 (DST started March 9)
    expect(row.value?.startTime.toISOString()).toBe("2025-03-15T16:00:00.000Z");
    expect(row.value?.endTime.toISOString()).toBe("2025-03-15T17:56:00.000Z");
  });

  test("V2 DST gap is rejected, DST overlap warns and takes the earlier instant", () => {
    const gap = oneRow(ROW.replace("2025-03-15T16:00:00Z", "2025-03-09 02:30").replace("2025-03-15T17:56:00Z", "2025-03-09 05:00"));
    expect(gap.errors[0]!.message).toContain("does not exist");

    const overlap = oneRow(
      ROW.replace("2025-03-15T16:00:00Z", "2025-11-02 01:30").replace("2025-03-15T17:56:00Z", "2025-11-02 04:00"),
    );
    expect(overlap.warnings.some((w) => w.message.includes("happens twice"))).toBe(true);
    expect(overlap.value?.startTime.toISOString()).toBe("2025-11-02T08:30:00.000Z"); // PDT, the first 1:30
  });

  test("V3 US month/day/year formats", () => {
    const row = oneRow(ROW.replace("2025-03-15T16:00:00Z", "3/15/2025 9:00 AM").replace("2025-03-15T17:56:00Z", "03/15/2025 10:56"));
    expect(row.value?.startTime.toISOString()).toBe("2025-03-15T16:00:00.000Z");
    expect(row.value?.endTime.toISOString()).toBe("2025-03-15T17:56:00.000Z");
    const noon = oneRow(ROW.replace("2025-03-15T16:00:00Z", "3/15/2025 12:00 PM").replace("2025-03-15T17:56:00Z", "3/15/2025 2:00 PM"));
    expect(noon.value?.startTime.toISOString()).toBe("2025-03-15T19:00:00.000Z");
  });

  test("V4 unparseable, impossible and date-only values", () => {
    expect(oneRow(ROW.replace("2025-03-15T16:00:00Z", "tomorrow")).errors[0]!.message).toContain("Unrecognized");
    expect(oneRow(ROW.replace("2025-03-15T16:00:00Z", "2025-02-30T10:00:00Z")).errors[0]!.message).toContain("Invalid date");
    expect(oneRow(ROW.replace("2025-03-15T16:00:00Z", "2025-03-15")).errors[0]!.message).toContain("no time");
  });

  test("V5 end before start", () => {
    const row = oneRow(ROW.replace("2025-03-15T17:56:00Z", "2025-03-15T15:00:00Z"));
    expect(row.errors[0]!.message).toContain("Ends before");
    expect(row.value).toBeNull();
  });

  test("V6 unusual runtime warns", () => {
    const row = oneRow(ROW.replace("2025-03-15T17:56:00Z", "2025-03-15T16:10:00Z"));
    expect(row.warnings[0]!.message).toContain("Unusual runtime: 10 minutes");
    expect(row.value).not.toBeNull();
  });

  test("V7 start in the past warns", () => {
    const row = oneRow(ROW, { now: new Date("2025-06-01T00:00:00Z") });
    expect(row.warnings.map((w) => w.message)).toContain("Start time is in the past.");
  });

  test("V9 unknown values are kept with a warning; empty optional values get defaults", () => {
    const row = oneRow(ROW.replace(",EN,2D,PG,", ",Klingon,Hologram,,"));
    expect(row.value?.language).toBe("KLINGON");
    expect(row.value?.format).toBe("HOLOGRAM");
    expect(row.value?.rating).toBe("NR");
    expect(row.warnings).toHaveLength(3);
  });

  test("unparseable last_updated is a warning, not an error", () => {
    const row = oneRow(ROW.replace("2025-03-10T12:00:00Z", "last week"));
    expect(row.value?.lastUpdated).toBeNull();
    expect(row.warnings[0]!.column).toBe("last_updated");
  });
});
