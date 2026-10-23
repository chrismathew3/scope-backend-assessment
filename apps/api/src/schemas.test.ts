import { describe, expect, test } from "bun:test";
import { ShowtimeCreateInput, ShowtimeUpdateInput, TheaterUpdateInput, UserUpdateInput } from "@scope/shared";

describe("update inputs reject empty patches", () => {
  test("user: no fields is a 400, not a 500 from the database", () => {
    const r = UserUpdateInput.safeParse({ id: "user-1" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Nothing to update");
  });

  test("user: one field is enough", () => {
    expect(UserUpdateInput.safeParse({ id: "user-1", name: "Sam" }).success).toBe(true);
    expect(UserUpdateInput.safeParse({ id: "user-1", isSuperAdmin: false }).success).toBe(true);
  });

  test("theater: no fields is rejected", () => {
    const r = TheaterUpdateInput.safeParse({ id: "theater-1" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Nothing to update");
  });

  test("theater: one field is enough", () => {
    expect(TheaterUpdateInput.safeParse({ id: "theater-1", location: "Main St" }).success).toBe(true);
  });
});

describe("showtime times have sane bounds", () => {
  const base = {
    theaterId: "theater-downtown",
    movieTitle: "Wonka",
    auditorium: "Aud 1",
    startTime: "2025-03-15T22:00:00Z",
    endTime: "2025-03-16T00:30:00Z", // past midnight is fine
    language: "EN",
    format: "2D",
    rating: "PG",
  };
  const issue = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

  test("a normal show, including one past midnight, is accepted", () => {
    expect(ShowtimeCreateInput.safeParse(base).success).toBe(true);
  });

  test("year 0001 (which crashed the audit snapshot) and 2101 are a 400 with a clear message", () => {
    const ancient = ShowtimeCreateInput.safeParse({ ...base, startTime: "0001-01-01T10:00:00Z", endTime: "0001-01-01T12:00:00Z" });
    expect(issue(ancient)).toBe("Dates must be between 2000 and 2100");
    expect(ShowtimeCreateInput.safeParse({ ...base, startTime: "2101-01-01T10:00:00Z", endTime: "2101-01-01T12:00:00Z" }).success).toBe(false);
    expect(issue(ShowtimeUpdateInput.safeParse({ id: "st-1", expectedVersion: 1, startTime: "0001-01-01T10:00:00Z" }))).toBe(
      "Dates must be between 2000 and 2100",
    );
  });

  test("runtime over 24 hours is refused; exactly 24 is allowed", () => {
    expect(issue(ShowtimeCreateInput.safeParse({ ...base, endTime: "2025-03-17T00:00:00Z" }))).toBe("A showtime can't run longer than 24 hours");
    expect(ShowtimeCreateInput.safeParse({ ...base, endTime: "2025-03-16T22:00:00Z" }).success).toBe(true);
    expect(
      issue(ShowtimeUpdateInput.safeParse({ id: "st-1", expectedVersion: 1, startTime: base.startTime, endTime: "2025-03-18T00:00:00Z" })),
    ).toBe("A showtime can't run longer than 24 hours");
  });
});
