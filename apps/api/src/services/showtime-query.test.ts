import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "./showtime-query";

const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const invalid = (cursor: string, sort: Parameters<typeof decodeCursor>[1]) => {
  try {
    decodeCursor(cursor, sort);
  } catch (e) {
    return (e as { code?: string; message?: string }).code === "BAD_REQUEST" && (e as Error).message === "Invalid cursor";
  }
  return false;
};

describe("decodeCursor", () => {
  test("cursors the API wrote round-trip for their sort", () => {
    expect(decodeCursor(encodeCursor(new Date("2025-03-15T18:00:00Z"), "st-1"), "startTime")).toEqual(["2025-03-15T18:00:00.000Z", "st-1"]);
    // Sort values come back from Postgres as text in its own format, microseconds included.
    expect(decodeCursor(encodeCursor("2025-03-15 12:00:00-04", "st-1"), "startTime")).toEqual(["2025-03-15 12:00:00-04", "st-1"]);
    expect(decodeCursor(encodeCursor("2025-03-01 04:00:00.123456+05:30", "st-1"), "lastUpdated")[0]).toBe("2025-03-01 04:00:00.123456+05:30");
    expect(decodeCursor(encodeCursor("dune part 2", "st-2"), "movieTitle")).toEqual(["dune part 2", "st-2"]);
    expect(decodeCursor(encodeCursor("needs-review", "st-3"), "movieStatus")).toEqual(["needs-review", "st-3"]);
  });

  test("a value that doesn't fit the sort is a 400, not a database cast error", () => {
    expect(invalid(encodeCursor("dune part 2", "st-1"), "startTime")).toBe(true); // a movieTitle cursor sent with sort=startTime
    expect(invalid(raw(["notadate", "x"]), "lastUpdated")).toBe(true);
    expect(invalid(raw(["2025", "x"]), "endTime")).toBe(true);
    expect(invalid(raw(["2025-02-30 12:00:00-04", "x"]), "startTime")).toBe(true); // no such day
    expect(invalid(raw(["2025-03-15 25:00:00-04", "x"]), "startTime")).toBe(true);
    expect(invalid(raw(["bogus", "x"]), "movieStatus")).toBe(true);
  });

  test("wrong shapes are a 400", () => {
    expect(invalid("not base64 json", "movieTitle")).toBe(true);
    expect(invalid(raw(["a"]), "movieTitle")).toBe(true);
    expect(invalid(raw([1, "x"]), "movieTitle")).toBe(true);
  });
});
