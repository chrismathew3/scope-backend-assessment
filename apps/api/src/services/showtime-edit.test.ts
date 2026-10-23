import { describe, expect, test } from "bun:test";
import {
  END_BEFORE_START,
  fromZonedFields,
  ShowtimeCreateInput,
  ShowtimeUpdateInput,
  toZonedFields,
} from "@scope/shared";
import type { showtimes } from "../db/schema";
import { diffShowtime, normalizeNewShowtime, normalizeShowtimeFields, ShowtimeFieldError } from "./showtime-edit";

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

const createBase = {
  theaterId: "riverside",
  movieTitle: "Dune: Part Two",
  auditorium: "Aud 1",
  startTime: "2026-10-23T19:30:00-04:00",
  endTime: "2026-10-23T22:16:00-04:00",
  language: "EN",
  format: "IMAX",
  rating: "PG-13",
};

describe("ShowtimeUpdateInput", () => {
  test("rejects a patch with nothing to change", () => {
    const r = ShowtimeUpdateInput.safeParse({ id: "s1", expectedVersion: 1 });
    expect(r.success).toBe(false);
    expect(messages(r)).toContain("Nothing to update");
  });

  test("accepts any single editable field", () => {
    for (const patch of [
      { movieTitle: "Heat" },
      { auditorium: "Aud 2" },
      { startTime: "2026-10-23T19:30:00Z" },
      { rating: "R" },
      { movieStatus: "approved" },
      { status: "archived" },
    ]) {
      expect(ShowtimeUpdateInput.safeParse({ id: "s1", expectedVersion: 3, ...patch }).success).toBe(true);
    }
  });

  test("rejects an end that isn't after the start when both are sent", () => {
    const same = ShowtimeUpdateInput.safeParse({
      id: "s1",
      expectedVersion: 1,
      startTime: "2026-10-23T20:00:00Z",
      endTime: "2026-10-23T20:00:00Z",
    });
    expect(messages(same)).toContain(END_BEFORE_START);
    // Offsets are compared as instants: 19:00-04:00 is 23:00Z, after 22:00Z.
    const offsets = ShowtimeUpdateInput.safeParse({
      id: "s1",
      expectedVersion: 1,
      startTime: "2026-10-23T22:00:00Z",
      endTime: "2026-10-23T19:00:00-04:00",
    });
    expect(offsets.success).toBe(true);
  });

  test("rejects blank text and times without an offset", () => {
    expect(messages(ShowtimeUpdateInput.safeParse({ id: "s1", expectedVersion: 1, movieTitle: "   " }))).toContain(
      "Title is required",
    );
    expect(ShowtimeUpdateInput.safeParse({ id: "s1", expectedVersion: 1, startTime: "2026-10-23T19:30" }).success).toBe(
      false,
    );
  });

  test("requires a positive expected version", () => {
    expect(ShowtimeUpdateInput.safeParse({ id: "s1", expectedVersion: 0, rating: "R" }).success).toBe(false);
  });
});

describe("ShowtimeCreateInput", () => {
  test("defaults movie status to needs-review and status to active", () => {
    const r = ShowtimeCreateInput.parse(createBase);
    expect(r.movieStatus).toBe("needs-review");
    expect(r.status).toBe("active");
  });

  test("every schedule field is required", () => {
    for (const key of ["movieTitle", "auditorium", "startTime", "endTime", "language", "format", "rating"] as const) {
      const { [key]: _, ...rest } = createBase;
      expect(ShowtimeCreateInput.safeParse(rest).success).toBe(false);
    }
  });

  test("rejects end before start", () => {
    const r = ShowtimeCreateInput.safeParse({ ...createBase, endTime: "2026-10-23T18:00:00-04:00" });
    expect(messages(r)).toContain(END_BEFORE_START);
  });
});

describe("normalizeShowtimeFields", () => {
  test("cleans text the way imports do and derives match keys", () => {
    const out = normalizeShowtimeFields({
      movieTitle: "  The  Dune:​ Part Two ",
      auditorium: "Screen #1",
      language: "english",
      format: "imax",
      rating: "pg13",
    });
    expect(out.movieTitle).toBe("The Dune: Part Two");
    expect(out.movieTitleKey).toBe("dune part 2");
    expect(out.auditorium).toBe("Screen #1");
    expect(out.auditoriumKey).toBe("auditorium 1");
    expect(out.language).toBe("EN");
    expect(out.format).toBe("IMAX");
    expect(out.rating).toBe("PG-13");
  });

  test("strips bidi control characters from a typed title and auditorium", () => {
    const out = normalizeShowtimeFields({ movieTitle: "\u202EWonka\u202C", auditorium: "Aud\u200F 1" });
    expect(out.movieTitle).toBe("Wonka");
    expect(out.auditorium).toBe("Aud 1");
    expect(() => normalizeShowtimeFields({ movieTitle: "\u202E\u2066" })).toThrow(ShowtimeFieldError);
  });

  test("leaves out fields that weren't sent", () => {
    expect(normalizeShowtimeFields({ rating: "R" })).toEqual({ rating: "R" });
  });

  test("a title that cleans down to nothing is an error", () => {
    expect(() => normalizeShowtimeFields({ movieTitle: "​​" })).toThrow(ShowtimeFieldError);
  });
});

describe("diffShowtime", () => {
  const current = {
    movieTitle: "Heat",
    auditorium: "Aud 1",
    startTime: new Date("2026-10-23T23:30:00Z"),
    endTime: new Date("2026-10-24T02:20:00Z"),
    language: "EN",
    format: "2D",
    rating: "R",
    movieStatus: "approved",
    status: "active",
  } as typeof showtimes.$inferSelect;

  test("reports only fields whose value changes, with dates as ISO strings", () => {
    const d = diffShowtime(current, {
      movieTitle: "Heat",
      startTime: new Date("2026-10-23T23:45:00Z"),
      rating: "R",
      status: "inactive",
    });
    expect(d.changed).toEqual(["startTime", "status"]);
    expect(d.before).toEqual({ startTime: "2026-10-23T23:30:00.000Z", status: "active" });
    expect(d.after).toEqual({ startTime: "2026-10-23T23:45:00.000Z", status: "inactive" });
  });

  test("an identical patch changes nothing", () => {
    expect(diffShowtime(current, { startTime: new Date(current.startTime) }).changed).toEqual([]);
  });
});

describe("theater-local form times", () => {
  test("round-trips a local time in the theater's zone", () => {
    const r = fromZonedFields("2026-10-23", "19:30", "America/New_York");
    expect(r.ok && r.date.toISOString()).toBe("2026-10-23T23:30:00.000Z");
    expect(toZonedFields("2026-10-23T23:30:00.000Z", "America/New_York")).toEqual({ date: "2026-10-23", time: "19:30" });
  });

  test("adds days for shows that end after midnight, across month ends", () => {
    const r = fromZonedFields("2026-10-31", "00:40", "America/Los_Angeles", 1);
    expect(r.ok && r.date.toISOString()).toBe("2026-11-01T07:40:00.000Z");
  });

  test("a time skipped by daylight saving is an error", () => {
    expect(fromZonedFields("2026-03-08", "02:30", "America/New_York").ok).toBe(false);
  });
});

describe("normalizeNewShowtime", () => {
  const { theaterId: _theaterId, ...fields } = createBase;
  test("returns every column a new showtime needs", () => {
    const out = normalizeNewShowtime({ ...fields, language: "english", format: "imax", rating: "pg-13" });
    expect(out.movieTitleKey).toBeTruthy();
    expect(out.auditoriumKey).toBeTruthy();
    expect(out.format).toBe("IMAX");
    expect(out.startTime).toBeInstanceOf(Date);
  });
  test("a field that cleans to nothing is a field error", () => {
    expect(() => normalizeNewShowtime({ ...fields, language: "en", format: "2D", rating: "PG", movieTitle: "   " })).toThrow(
      ShowtimeFieldError,
    );
  });
});
