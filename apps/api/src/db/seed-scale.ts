/**
 * Loads a large synthetic schedule for search benchmarks (default 500,000 showtimes).
 * Run it against a separate database whose name contains "scale", after
 * db:migrate and db:seed there, so the demo database is never touched:
 *
 *   createdb scope_showtimes_scale
 *   export DATABASE_URL=postgresql://scope_app:...@localhost:5432/scope_showtimes_scale
 *   export MIGRATION_DATABASE_URL=postgresql://localhost:5432/scope_showtimes_scale
 *   bun run db:migrate && bun run db:seed && bun run db:seed:scale -- --rows=500000
 *
 * 60% of rows go to the three seeded theaters (so seeded users see big
 * schedules), the rest to 47 extra theaters. Status mix: 70% active,
 * 20% inactive, 10% archived.
 */
import postgres from "postgres";
import { auditoriumKey, titleKey } from "../csv";
import { env } from "../env";

const rowsArg = process.argv.find((a) => a.startsWith("--rows="));
const TOTAL = rowsArg ? Number(rowsArg.split("=")[1]) : 500_000;
const ownerUrl = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
const dbName = new URL(ownerUrl).pathname.slice(1);
if (!dbName.includes("scale")) {
  throw new Error(`Refusing to load ${TOTAL} rows into "${dbName}". Use a database whose name contains "scale".`);
}

const sql = postgres(ownerUrl, { max: 4, onnotice: () => undefined });

// Deterministic PRNG so runs are comparable.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

const A = ["Silent", "Crimson", "Last", "Hidden", "Electric", "Broken", "Golden", "Midnight", "Lost", "Wild",
  "Iron", "Paper", "Glass", "Distant", "Burning", "Frozen", "Secret", "Little", "Endless", "Northern",
  "Velvet", "Hollow", "Neon", "Scarlet", "Quiet", "Savage", "Bright", "Fallen", "Restless", "Copper"];
const N = ["Harbor", "Kingdom", "Signal", "Garden", "Empire", "River", "Machine", "Witness", "Summer", "Frontier",
  "Orchard", "Station", "Mirror", "Voyage", "Canyon", "Letter", "Island", "Circus", "Engine", "Lighthouse",
  "Highway", "Country", "Season", "Promise", "Shadow", "Monarch", "Archive", "Harvest", "Parade", "Atlas"];
const S = ["", "", "", "", ": Reckoning", ": Origins", " Returns", " Rising", ": Part Two", " of the Deep"];
// 30 × 30 × 10 ≈ 9,000 distinct titles, with the duplicates a real catalogue has.
const titles = [...new Set(Array.from({ length: 12_000 }, () => `${pick(A)} ${pick(N)}${pick(S)}`))].map((t) => ({
  title: t,
  key: titleKey(t),
}));

const FORMATS = ["Standard", "Standard", "Standard", "IMAX", "3D", "Dolby Cinema", "4DX"];
const LANGS = ["English", "English", "English", "English", "Spanish", "French", "Japanese", "Korean"];
const RATINGS = ["G", "PG", "PG-13", "PG-13", "R", "R", "NR"];
const MOVIE = ["approved", "approved", "approved", "draft", "flagged", "needs-review"];

const extra = Array.from({ length: 47 }, (_, i) => ({
  id: `theater-scale-${String(i + 1).padStart(3, "0")}`,
  name: `Scale Cinema ${String(i + 1).padStart(3, "0")}`,
  location: "Benchmark City",
  timezone: "America/New_York",
}));
await sql`insert into theater ${sql(extra, "id", "name", "location", "timezone")} on conflict (id) do nothing`;
const seeded = ["theater-downtown", "theater-riverside", "theater-uptown"];

// Unique start times per theater keep the "one active per title + start" index happy.
const nextSlot = new Map<string, number>();
const base = Date.UTC(2025, 0, 1, 12);
const CHUNK = 5_000;
const t0 = performance.now();

for (let done = 0; done < TOTAL; done += CHUNK) {
  const n = Math.min(CHUNK, TOTAL - done);
  const cols: Record<string, unknown[]> = {
    id: [], theater_id: [], movie_title: [], movie_title_key: [], movie_status: [], auditorium: [],
    auditorium_key: [], start_time: [], end_time: [], language: [], format: [], rating: [], status: [],
    archived_at: [],
  };
  for (let i = 0; i < n; i++) {
    const theaterId = rand() < 0.6 ? pick(seeded) : pick(extra).id;
    const slot = nextSlot.get(theaterId) ?? 0;
    nextSlot.set(theaterId, slot + 1);
    const start = new Date(base + slot * 7 * 60_000);
    const t = pick(titles);
    const aud = `Auditorium ${1 + Math.floor(rand() * 16)}`;
    const r = rand();
    const status = r < 0.7 ? "active" : r < 0.9 ? "inactive" : "archived";
    cols.id!.push(`scale-${done + i}`);
    cols.theater_id!.push(theaterId);
    cols.movie_title!.push(t.title);
    cols.movie_title_key!.push(t.key);
    cols.movie_status!.push(pick(MOVIE));
    cols.auditorium!.push(aud);
    cols.auditorium_key!.push(auditoriumKey(aud));
    cols.start_time!.push(start.toISOString());
    cols.end_time!.push(new Date(start.getTime() + (90 + Math.floor(rand() * 90)) * 60_000).toISOString());
    cols.language!.push(pick(LANGS));
    cols.format!.push(pick(FORMATS));
    cols.rating!.push(pick(RATINGS));
    cols.status!.push(status);
    cols.archived_at!.push(status === "archived" ? start.toISOString() : null);
  }
  await sql`
    insert into showtime (id, theater_id, movie_title, movie_title_key, movie_status, auditorium, auditorium_key,
      start_time, end_time, language, format, rating, status, archived_at)
    select * from unnest(
      ${cols.id as string[]}::text[], ${cols.theater_id as string[]}::text[], ${cols.movie_title as string[]}::text[],
      ${cols.movie_title_key as string[]}::text[], ${cols.movie_status as string[]}::movie_status[],
      ${cols.auditorium as string[]}::text[], ${cols.auditorium_key as string[]}::text[],
      ${cols.start_time as string[]}::timestamptz[], ${cols.end_time as string[]}::timestamptz[],
      ${cols.language as string[]}::text[], ${cols.format as string[]}::text[], ${cols.rating as string[]}::text[],
      ${cols.status as string[]}::showtime_status[], ${cols.archived_at as (string | null)[]}::timestamptz[])
    on conflict (id) do nothing`;
  if ((done / CHUNK) % 20 === 0) process.stdout.write(`  ${done + n} rows\n`);
}

await sql`analyze showtime`;
const [row] = await sql<{ n: number }[]>`select count(*)::int as n from showtime`;
const n = row?.n ?? 0;
console.log(`showtime now holds ${n} rows (${titles.length} distinct titles), ${((performance.now() - t0) / 1000).toFixed(1)}s`);
await sql.end();
