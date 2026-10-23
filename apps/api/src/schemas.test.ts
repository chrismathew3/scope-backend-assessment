import { describe, expect, test } from "bun:test";
import { TheaterUpdateInput, UserUpdateInput } from "@scope/shared";

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
