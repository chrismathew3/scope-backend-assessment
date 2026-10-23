/**
 * Access rules, in one place. The API enforces these; the UI reads the same
 * object to decide what to render.
 *
 * Model:
 *  - Each user has zero or more theater memberships, each with a role.
 *  - A super admin is an admin of every theater (current and future) and can
 *    also manage users, theaters and memberships.
 */
import type { TheaterRole } from "./enums";

/** Permissions that apply inside one theater. */
export const THEATER_PERMISSIONS = {
  viewer: ["showtime.read"],
  admin: [
    "showtime.read",
    "showtime.readInternal", // movieStatus, status, timestamps, non-active rows
    "showtime.create",
    "showtime.update", // every field; archiving (status "archived") is the delete
    "schedule.archiveAll",
    "import.manage",
    "member.read",
    "member.manageViewers", // add/remove viewers in this theater
    "audit.read",
  ],
} as const satisfies Record<TheaterRole, readonly string[]>;

export type TheaterPermission = (typeof THEATER_PERMISSIONS)["admin"][number];

/** Permissions only a super admin holds. They are not tied to one theater. */
export const SUPER_ADMIN_PERMISSIONS = [
  "user.manage", // create users, set super admin, deactivate
  "theater.manage", // create, rename, archive theaters
  "member.manageAll", // grant any role in any theater
  "audit.readAll",
] as const;

export type GlobalPermission = (typeof SUPER_ADMIN_PERMISSIONS)[number];

export interface Principal {
  userId: string;
  isSuperAdmin: boolean;
  /** theaterId -> role. For super admins the server fills every theater with "admin". */
  theaterRoles: Record<string, TheaterRole>;
}

function roleIn(p: Principal, theaterId: string): TheaterRole | null {
  if (p.isSuperAdmin) return "admin";
  return p.theaterRoles[theaterId] ?? null;
}

export function can(p: Principal, permission: TheaterPermission, theaterId: string): boolean;
export function can(p: Principal, permission: GlobalPermission): boolean;
export function can(
  p: Principal,
  permission: TheaterPermission | GlobalPermission,
  theaterId?: string,
): boolean {
  if ((SUPER_ADMIN_PERMISSIONS as readonly string[]).includes(permission)) {
    return p.isSuperAdmin;
  }
  if (!theaterId) return false;
  const role = roleIn(p, theaterId);
  if (!role) return false;
  return (THEATER_PERMISSIONS[role] as readonly string[]).includes(permission);
}

/** Theater ids where the principal holds a permission. */
export function theatersWhere(p: Principal, permission: TheaterPermission): string[] {
  return Object.keys(p.theaterRoles).filter((id) => can(p, permission, id));
}

/**
 * Why the principal may not grant or remove `role` in this theater, or null if they may.
 * Admins manage viewers in their own theaters; only a super admin manages admins.
 */
export function membershipChangeDenied(p: Principal, theaterId: string, role: TheaterRole): string | null {
  if (can(p, "member.manageAll")) return null;
  if (!can(p, "member.manageViewers", theaterId)) return "Only admins of that theater can add or remove people there";
  if (role !== "viewer") return "Only a super admin can grant or remove admin access";
  return null;
}
