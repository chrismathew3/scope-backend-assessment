import { describe, expect, test } from "bun:test";
import {
  can,
  type Principal,
  SUPER_ADMIN_PERMISSIONS,
  THEATER_PERMISSIONS,
  type TheaterPermission,
  theatersWhere,
} from "@scope/shared";

const ALL_THEATER_PERMS = THEATER_PERMISSIONS.admin as readonly TheaterPermission[];

const mixed: Principal = { userId: "taylor", isSuperAdmin: false, theaterRoles: { riverside: "admin", downtown: "viewer" } };
const none: Principal = { userId: "jordan", isSuperAdmin: false, theaterRoles: {} };
const superAdmin: Principal = { userId: "sam", isSuperAdmin: true, theaterRoles: { downtown: "admin", riverside: "admin", uptown: "admin" } };

describe("permission matrix", () => {
  test.each(ALL_THEATER_PERMS.map((p) => [p]))("admin of a theater has %s there", (perm) => {
    expect(can(mixed, perm, "riverside")).toBe(true);
  });

  test.each(ALL_THEATER_PERMS.map((p) => [p]))("viewer has %s only if it is showtime.read", (perm) => {
    expect(can(mixed, perm, "downtown")).toBe(perm === "showtime.read");
  });

  test.each(ALL_THEATER_PERMS.map((p) => [p]))("nobody has %s in a theater they don't belong to", (perm) => {
    expect(can(mixed, perm, "uptown")).toBe(false);
    expect(can(none, perm, "downtown")).toBe(false);
  });

  test("super admin is admin of every theater, including ones not in their memberships", () => {
    for (const perm of ALL_THEATER_PERMS) {
      expect(can(superAdmin, perm, "uptown")).toBe(true);
      expect(can({ ...superAdmin, theaterRoles: {} }, perm, "brand-new-theater")).toBe(true);
    }
  });

  test.each(SUPER_ADMIN_PERMISSIONS.map((p) => [p]))("only super admins hold %s", (perm) => {
    expect(can(superAdmin, perm)).toBe(true);
    expect(can(mixed, perm)).toBe(false);
    expect(can(none, perm)).toBe(false);
  });

  test("theatersWhere splits a mixed user by role", () => {
    expect(theatersWhere(mixed, "showtime.update")).toEqual(["riverside"]);
    expect(theatersWhere(mixed, "showtime.read").sort()).toEqual(["downtown", "riverside"]);
    expect(theatersWhere(none, "showtime.read")).toEqual([]);
  });
});
