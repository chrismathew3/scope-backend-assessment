/**
 * Cookie sessions. The browser holds a random 256-bit token; the database
 * holds only its SHA-256, so a leaked table can't be replayed.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { isProd } from "../env";

export const SESSION_COOKIE = "scope_session";
const IDLE_MS = 12 * 60 * 60 * 1000; // signed out after 12h of inactivity
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // and after 7 days no matter what
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + IDLE_MS),
    ipAddress: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

/** Returns the signed-in user, or null. Slides the idle window forward. */
export async function resolveSession(token: string): Promise<{ sessionId: string; user: SessionUser } | null> {
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      name: users.name,
      email: users.email,
      isSuperAdmin: users.isSuperAdmin,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), eq(users.status, "active")))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.createdAt.getTime() > ABSOLUTE_MS) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + IDLE_MS) })
      .where(eq(sessions.id, row.sessionId));
  }
  const { sessionId, id, name, email, isSuperAdmin, mustChangePassword } = row;
  return { sessionId, user: { id, name, email, isSuperAdmin, mustChangePassword } };
}

export async function deleteSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Sign a user out everywhere (deactivation, password reset, super admin change). */
export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.id !== exceptSessionId) await deleteSession(s.id);
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function sessionCookie(token: string) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ABSOLUTE_MS / 1000)}`,
    isProd ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
