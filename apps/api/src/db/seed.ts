/**
 * Loads the original fixture (theaters, users, showtimes) as the owner role.
 * Every seeded user gets SEED_PASSWORD. Safe to re-run: it upserts.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../auth/password";
import { auditoriumKey, cleanText, titleKey } from "../csv";
import { env } from "../env";
import { fixtures } from "./fixtures";
import * as schema from "./schema";

const sql = postgres(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, { max: 1, onnotice: () => undefined });
const db = drizzle(sql, { schema });
const { theaters, users, theaterMemberships, showtimes } = schema;

const passwordHash = await hashPassword(env.SEED_PASSWORD);

await db.transaction(async (tx) => {
  for (const t of fixtures.theaters) {
    await tx.insert(theaters).values(t).onConflictDoUpdate({ target: theaters.id, set: t });
  }
  for (const u of fixtures.users) {
    const values = {
      id: u.id,
      name: u.name,
      email: u.email,
      isSuperAdmin: u.isSuperAdmin ?? false,
      passwordHash,
      status: "active" as const,
    };
    await tx.insert(users).values(values).onConflictDoUpdate({ target: users.id, set: values });
    for (const m of u.memberships) {
      await tx
        .insert(theaterMemberships)
        .values({ userId: u.id, theaterId: m.theaterId, role: m.role })
        .onConflictDoUpdate({
          target: [theaterMemberships.userId, theaterMemberships.theaterId],
          set: { role: m.role },
        });
    }
  }
  for (const s of fixtures.showtimes) {
    const title = cleanText(s.movieTitle);
    const values = {
      id: s.id,
      theaterId: s.theaterId,
      movieTitle: title,
      movieTitleKey: titleKey(title),
      movieStatus: s.movieStatus,
      auditorium: s.auditorium,
      auditoriumKey: auditoriumKey(s.auditorium),
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
      language: s.language,
      format: s.format,
      rating: s.rating,
      status: s.status,
      sourceUpdatedAt: new Date(s.lastUpdated),
      archivedAt: s.status === "archived" ? new Date(s.lastUpdated) : null,
      createdAt: new Date(s.lastUpdated),
      updatedAt: new Date(s.lastUpdated),
    };
    await tx.insert(showtimes).values(values).onConflictDoUpdate({ target: showtimes.id, set: values });
  }
});

console.log(
  `seeded ${fixtures.theaters.length} theaters, ${fixtures.users.length} users, ${fixtures.showtimes.length} showtimes`,
);
console.log(`every seeded user's password: ${env.SEED_PASSWORD}`);
await sql.end();
