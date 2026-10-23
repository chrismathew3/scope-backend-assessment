/**
 * Times the real search code (listShowtimes / showtimeFacets) against a large
 * schedule, as the app role with row-level security on, for each kind of user.
 * Point DATABASE_URL at a database loaded by db:seed:scale.
 *
 *   bun src/scripts/bench-search.ts [--explain]
 */
import { ShowtimeListInput, type Principal } from "@scope/shared";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { env } from "../env";
import { listShowtimes, showtimeFacets } from "../services/showtime-query";

const explain = process.argv.includes("--explain");
let captured: { query: string; params: unknown[] }[] = [];
const client = postgres(env.DATABASE_URL, {
  max: 1,
  onnotice: () => undefined,
  debug: (_c, query, params) => captured.push({ query, params: params as unknown[] }),
});
const db = drizzle(client, { schema });

const allTheaters = (await db.select({ id: schema.theaters.id }).from(schema.theaters)).map((t) => t.id);
const people: Record<string, Principal> = {
  "super admin (50 theaters)": {
    userId: "user-super-sam",
    isSuperAdmin: true,
    theaterRoles: Object.fromEntries(allTheaters.map((id) => [id, "admin" as const])),
  },
  "admin (3 theaters)": {
    userId: "user-admin-casey",
    isSuperAdmin: false,
    theaterRoles: { "theater-downtown": "admin", "theater-riverside": "admin", "theater-uptown": "admin" },
  },
  "viewer (2 theaters)": {
    userId: "user-viewer-morgan",
    isSuperAdmin: false,
    theaterRoles: { "theater-downtown": "viewer", "theater-uptown": "viewer" },
  },
};

const cases: [string, Record<string, unknown>][] = [
  ["first page, by start time", {}],
  ["title search, substring", { q: "lighthouse" }],
  ["title search, typo", { q: "midnite lighthuose" }],
  ["search + format + language", { q: "harbor", format: "IMAX", language: "English" }],
  ["date range", { from: "2025-06-01T00:00:00Z", to: "2025-06-08T00:00:00Z" }],
  ["sort by title", { sort: "movieTitle", order: "asc" }],
  ["sort by last updated", { sort: "lastUpdated", order: "desc", status: "all" }],
  ["sort by end time", { sort: "endTime", order: "asc" }],
  ["sort by theater", { sort: "theaterName", order: "asc" }],
  ["sort by movie status", { sort: "movieStatus", order: "asc" }],
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function run<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${p.userId}, true)`);
    return fn(tx);
  });
}

async function time(p: Principal, fn: (tx: Tx) => Promise<unknown>, reps = 7) {
  await run(p, fn); // warm
  const ms: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    await run(p, fn);
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { p50: ms[Math.floor(reps / 2)]!, max: ms.at(-1)! };
}

const [row] = await client<{ n: number }[]>`select reltuples::int as n from pg_class where relname = 'showtime'`;
const n = row?.n ?? 0;
console.log(`showtime rows: ${n.toLocaleString()}\n`);
console.log("| User | Query | Rows matched | p50 ms | max ms |\n|---|---|---|---|---|");
const slow: { label: string; p: Principal; input: Record<string, unknown>; p50: number }[] = [];

for (const [who, p] of Object.entries(people)) {
  for (const [label, raw] of cases) {
    if (["lastUpdated", "movieStatus"].includes(raw.sort as string) && who.startsWith("viewer")) continue; // admin-only sort
    const input = ShowtimeListInput.parse(raw);
    const result = await run(p, (tx) => listShowtimes(tx, p, input));
    const { p50, max } = await time(p, (tx) => listShowtimes(tx, p, input));
    // Keyset: page 3 costs the same as page 1.
    console.log(`| ${who} | ${label} | ${result.totalCapped ? "10,000+" : result.total.toLocaleString()} | ${p50.toFixed(1)} | ${max.toFixed(1)} |`);
    slow.push({ label: `${who} / ${label}`, p, input: raw, p50 });
  }
  const first = await run(p, (tx) => listShowtimes(tx, p, ShowtimeListInput.parse({})));
  if (first.nextCursor) {
    const cursor = first.nextCursor;
    const { p50, max } = await time(p, (tx) => listShowtimes(tx, p, ShowtimeListInput.parse({ cursor })));
    console.log(`| ${who} | next page (keyset cursor) | | ${p50.toFixed(1)} | ${max.toFixed(1)} |`);
  }
  const { p50, max } = await time(p, (tx) => showtimeFacets(tx, p));
  console.log(`| ${who} | filter values (facets) | | ${p50.toFixed(1)} | ${max.toFixed(1)} |`);
}

if (explain) {
  for (const s of slow.sort((a, b) => b.p50 - a.p50).slice(0, 3)) {
    captured = [];
    await run(s.p, (tx) => listShowtimes(tx, s.p, ShowtimeListInput.parse(s.input)));
    const page = captured.find((c) => c.query.includes("order by"));
    if (!page) continue;
    const plan = await client.begin(async (t) => {
      await t`select set_config('app.user_id', ${s.p.userId}, true)`;
      if (s.input.q) await t`select set_config('pg_trgm.word_similarity_threshold', '0.45', true)`;
      return t.unsafe(`explain (analyze, buffers, costs off) ${page.query}`, page.params as never[]);
    });
    console.log(`\n### ${s.label}\n\`\`\`\n${(plan as unknown as { "QUERY PLAN": string }[]).map((r) => r["QUERY PLAN"]).join("\n")}\n\`\`\``);
  }
}
await client.end();
