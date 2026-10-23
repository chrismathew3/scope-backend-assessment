/**
 * End-to-end suite against a RUNNING stack (API on :8787, Postgres, real AI agent).
 *   E2E=1 bun test test/e2e          (from apps/api; or `bun run test:e2e`)
 * It resets the demo data before each scenario, so don't run it against a database you care about.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const RUN = process.env.E2E === "1";
const API = process.env.E2E_API ?? "http://localhost:8787";
const OWNER_DB = process.env.MIGRATION_DATABASE_URL ?? "postgresql://localhost:5432/scope_showtimes";
const PASSWORD = "showtimes-dev-pass";
const AI_TIMEOUT = 90_000;

const fixture = (p: string) => readFileSync(new URL(`../fixtures/csv/${p}`, import.meta.url));
const sample = (name: string) => readFileSync(new URL(`../../../../sample-data/${name}`, import.meta.url));
const b64 = (buf: Uint8Array | string) => Buffer.from(buf).toString("base64");
const csv = (rows: string[]) =>
  ["theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated", ...rows].join("\n");

/* ───────── tiny REST client with a cookie jar ───────── */

class Client {
  cookie = "";
  constructor(readonly email: string) {}
  async login(password = PASSWORD) {
    const r = await this.req("POST", "/auth/login", { email: this.email, password });
    return r;
  }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    const m = set && /scope_session=([^;]*)/.exec(set);
    if (m) this.cookie = m[1] ? `scope_session=${m[1]}` : "";
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: unknown = {}) => this.req("POST", p, b);
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  del = (p: string) => this.req("DELETE", p);
  upload = (theaterId: string, filename: string, content: Uint8Array | string) =>
    this.post(`/theaters/${theaterId}/imports`, { theaterId, filename, contentBase64: b64(content) });
}

const users = {
  sam: new Client("sam.super@example.com"),
  avery: new Client("avery.admin@example.com"),
  casey: new Client("casey.operator@example.com"),
  taylor: new Client("taylor.mixed@example.com"),
  riley: new Client("riley.viewer@example.com"),
  morgan: new Client("morgan.multi@example.com"),
  jordan: new Client("jordan.notheater@example.com"),
};
let sql: ReturnType<typeof postgres>;

async function reset() {
  const r = await users.sam.post("/demo/reset");
  expect(r.status).toBe(200);
}
async function showtime(id: string) {
  const [row] = await sql`select * from showtime where id = ${id}`;
  return row as Record<string, any>;
}
const byLine = (detail: any) => Object.fromEntries(detail.rows.map((r: any) => [r.lineNumber, r]));
const expected = JSON.parse(readFileSync(new URL("../fixtures/csv/agent-expected.json", import.meta.url), "utf8"));

describe.skipIf(!RUN)("end to end", () => {
  beforeAll(async () => {
    sql = postgres(OWNER_DB, { max: 2, onnotice: () => undefined });
    for (const u of Object.values(users)) expect((await u.login()).status).toBe(200);
    await reset();
  });
  afterAll(async () => {
    await reset();
    await sql.end();
  });

  /* ───────── health, auth, docs ───────── */

  test("health, OpenAPI and docs are up", async () => {
    expect((await fetch(`${API}/api/health`)).status).toBe(200);
    const spec = await (await fetch(`${API}/api/openapi.json`)).json();
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(20);
    expect((await fetch(`${API}/api/docs`)).status).toBe(200);
  });

  test("auth: bad password, no cookie, logout, cross-site POST", async () => {
    const stranger = new Client("riley.viewer@example.com");
    expect((await stranger.login("wrong-password")).status).toBe(401);
    expect((await stranger.get("/me")).status).toBe(401);
    const temp = new Client("morgan.multi@example.com");
    await temp.login();
    expect((await temp.get("/me")).status).toBe(200);
    const saved = temp.cookie;
    await temp.post("/auth/logout");
    temp.cookie = saved; // replaying the old cookie must fail
    expect((await temp.get("/me")).status).toBe(401);
    const csrf = await users.avery.req("POST", "/auth/logout", {}, { origin: "https://evil.example" });
    expect(csrf.status).toBe(403);
  });

  test("login is rate limited per email", async () => {
    const victim = new Client(`nobody-${Date.now()}@example.com`);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await victim.login("nope")).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  /* ───────── visibility by role ───────── */

  test("each role sees exactly its theaters, viewers get no internal fields", async () => {
    const list = async (c: Client, q = "") => (await c.get(`/showtimes?limit=100${q}`)).json;
    const sam = await list(users.sam);
    expect(sam.total).toBe(15);
    expect(sam.items.every((i: any) => i.access === "admin")).toBe(true);

    const riley = await list(users.riley);
    expect(riley.total).toBe(5); // Downtown active only
    expect(riley.items.every((i: any) => i.access === "viewer" && !("movieStatus" in i) && !("status" in i))).toBe(true);

    const taylor = await list(users.taylor);
    const admin = taylor.items.filter((i: any) => i.access === "admin");
    const viewer = taylor.items.filter((i: any) => i.access === "viewer");
    expect(admin.every((i: any) => i.theaterId === "theater-riverside")).toBe(true);
    expect(viewer.every((i: any) => i.theaterId === "theater-downtown")).toBe(true);
    expect(admin.some((i: any) => i.status === "archived")).toBe(true); // admin sees archived
    expect(viewer.length).toBe(5);

    const morgan = await list(users.morgan);
    expect(new Set(morgan.items.map((i: any) => i.theaterId))).toEqual(new Set(["theater-downtown", "theater-uptown"]));

    expect((await list(users.jordan)).total).toBe(0);
    expect((await users.jordan.get("/theaters")).json).toEqual([]);
  });

  test("viewers can't reach hidden rows, other theaters, or admin-only sorts", async () => {
    expect((await users.riley.get("/showtimes/st-dt-005")).status).toBe(404); // archived
    expect((await users.riley.get("/showtimes?theaterId=theater-uptown")).status).toBe(404);
    expect((await users.riley.get("/showtimes?sort=movieStatus")).status).toBe(400);
    expect((await users.riley.get("/showtimes?movieStatus=approved")).json.total).toBe(0);
    const facets = (await users.riley.get("/showtimes/facets")).json;
    expect(facets.canSeeInternal).toBe(false);
    expect(facets.movieStatuses).toEqual([]);
  });

  /* ───────── search, filters, sort, pagination ───────── */

  test("search tolerates typos and filters/sorts/pages correctly", async () => {
    const titles = async (q: string) => (await users.sam.get(`/showtimes?limit=100&q=${encodeURIComponent(q)}`)).json.items.map((i: any) => i.movieTitle);
    expect(await titles("oppenhiemer")).toContain("Oppenheimer");
    expect(await titles("dune prt 2")).toContain("Dune: Part Two");
    expect(await titles("spidr")).toContain("Spider-Man: Homecoming");
    expect(await titles("zzzzqqq")).toEqual([]);

    const imax = (await users.sam.get("/showtimes?format=IMAX&limit=100")).json.items;
    expect(imax.length).toBeGreaterThan(0);
    expect(imax.every((i: any) => i.format === "IMAX")).toBe(true);
    const archived = (await users.sam.get("/showtimes?status=archived&limit=100")).json.items;
    expect(archived.every((i: any) => i.status === "archived")).toBe(true);

    const desc = (await users.sam.get("/showtimes?sort=startTime&order=desc&limit=100")).json.items.map((i: any) => i.startTime);
    expect([...desc].sort().reverse()).toEqual(desc);

    // Walk every page of 4; no repeats, no gaps.
    const seen: string[] = [];
    let cursor = "";
    for (let i = 0; i < 10; i++) {
      const page = (await users.sam.get(`/showtimes?limit=4&sort=movieTitle${cursor ? `&cursor=${cursor}` : ""}`)).json;
      seen.push(...page.items.map((x: any) => x.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.length).toBe(15);
    expect(new Set(seen).size).toBe(15);
  });

  /* ───────── admin edits ───────── */

  test("admins edit their theaters only, with optimistic locking", async () => {
    expect((await users.riley.patch("/showtimes/st-dt-001", { expectedVersion: 1, movieStatus: "flagged" })).status).toBe(403);
    expect((await users.taylor.patch("/showtimes/st-dt-001", { expectedVersion: 1, movieStatus: "flagged" })).status).toBe(403);
    const ok = await users.avery.patch("/showtimes/st-dt-001", { expectedVersion: 1, movieStatus: "flagged" });
    expect(ok.status).toBe(200);
    expect(ok.json.movieStatus).toBe("flagged");
    expect((await users.avery.patch("/showtimes/st-dt-001", { expectedVersion: 1, movieStatus: "draft" })).status).toBe(409);
    await reset();
  });

  test("admins have full write: edit any field, create, archive; viewers can't", async () => {
    const before = await showtime("st-rv-001");
    const versionOf = async () => (await sql`select schedule_version as v from theater where id='theater-riverside'`)[0]?.v as number;
    const versionBefore = await versionOf();
    const start = new Date(before.start_time.getTime() + 30 * 60_000).toISOString();
    const end = new Date(before.end_time.getTime() + 30 * 60_000).toISOString();

    // Taylor: admin in Riverside, viewer in Downtown.
    const edit = await users.taylor.patch("/showtimes/st-rv-001", {
      expectedVersion: before.version,
      movieTitle: "  The Fall Guy (Director's Cut) ",
      auditorium: "Aud 7",
      startTime: start,
      endTime: end,
      format: "imax",
    });
    expect(edit.status).toBe(200);
    const after = await showtime("st-rv-001");
    expect(after.movie_title).toBe("The Fall Guy (Director's Cut)");
    expect(after.auditorium_key).toBe("auditorium 7");
    expect(after.start_time.toISOString()).toBe(start);
    expect(after.version).toBe(before.version + 1);
    expect(await versionOf()).toBeGreaterThan(versionBefore);
    const [entry] = await sql`select * from audit_log where action='showtime.update' and entity_id='st-rv-001' order by created_at desc limit 1`;
    expect(entry).toBeTruthy();

    expect((await users.taylor.patch("/showtimes/st-dt-001", { expectedVersion: 1, movieTitle: "Nope" })).status).toBe(403);
    expect((await users.riley.patch("/showtimes/st-dt-001", { expectedVersion: 1, auditorium: "Aud 9" })).status).toBe(403);
    expect((await users.taylor.patch("/showtimes/st-rv-001", { expectedVersion: before.version, rating: "R" })).status).toBe(409);
    const backwards = await users.taylor.patch("/showtimes/st-rv-001", {
      expectedVersion: after.version,
      startTime: end,
      endTime: start,
    });
    expect(backwards.status).toBe(400);

    const fresh = {
      theaterId: "theater-riverside",
      movieTitle: "Challengers",
      auditorium: "Auditorium B",
      startTime: "2025-03-16T03:00:00Z",
      endTime: "2025-03-16T05:11:00Z",
      language: "English",
      format: "2D",
      rating: "R",
    };
    const created = await users.taylor.post("/showtimes", fresh);
    expect(created.status).toBe(200);
    expect(created.json.movieStatus).toBe("needs-review");
    expect((await users.taylor.post("/showtimes", fresh)).status).toBe(409); // same film + start
    expect((await users.taylor.post("/showtimes", { ...fresh, theaterId: "theater-downtown" })).status).toBe(403);
    expect((await users.riley.post("/showtimes", { ...fresh, theaterId: "theater-downtown" })).status).toBe(403);

    // Archive is the delete.
    const archived = await users.taylor.patch(`/showtimes/${created.json.id}`, { expectedVersion: 1, status: "archived" });
    expect(archived.status).toBe(200);
    expect((await showtime(created.json.id)).archived_at).not.toBeNull();
    await reset();
  });

  /* ───────── the AI import flow ───────── */

  test(
    "new-drop.csv: agent matches the brief, approvals are honoured, outcome persists",
    async () => {
      await reset();
      const up = await users.avery.upload("theater-downtown", "new-drop.csv", sample("new-drop.csv"));
      expect(up.status).toBe(200);
      const d = up.json;
      expect(d.summary.agent.status).toBe("ok");
      const rows = byLine(d);
      for (const [line, exp] of Object.entries<any>(expected["new-drop"].rows)) {
        expect(rows[line].outcome).toBe(exp.outcome);
        expect(rows[line].showtimeId).toBe(exp.showtimeId);
      }
      expect(d.archives.map((a: any) => a.showtimeId)).toEqual(expected["new-drop"].archives);
      expect(d.rows.every((r: any) => typeof r.explanation === "string" && r.explanation.length > 5)).toBe(true);
      expect(d.rows.some((r: any) => /operator|instruction/i.test(r.explanation))).toBe(false);
      // Stored titles win over partner spelling.
      expect(rows[2].diffs.some((x: any) => x.field === "movieTitle")).toBe(false);
      expect(rows[2].partnerTitle).toBe("Spider Man - Homecoming");

      // Viewers and other-theater admins can't see or apply it.
      expect((await users.riley.get(`/imports/${d.summary.id}`)).status).toBe(404);
      expect((await users.taylor.get(`/imports/${d.summary.id}`)).status).toBe(404);
      expect((await users.taylor.post(`/imports/${d.summary.id}/apply`, {})).status).toBe(404);

      // Reject line 3 (Inside Out 2) and keep st-dt-007 (untick its archive).
      const applied = await users.avery.post(`/imports/${d.summary.id}/apply`, {
        decisions: { rows: [{ lineNumber: 3, accepted: false }], archives: [{ showtimeId: "st-dt-007", accepted: false }] },
      });
      expect(applied.status).toBe(200);
      expect(applied.json.summary.status).toBe("applied");

      expect((await showtime("st-dt-001")).auditorium).toBe("Aud 1");
      expect((await showtime("st-dt-001")).movie_title).toBe("Spider-Man: Homecoming");
      expect((await showtime("st-dt-002")).auditorium).toBe("Auditorium 2"); // rejected: untouched
      expect((await showtime("st-dt-003")).movie_title).toBe("Dune: Part Two");
      expect((await showtime("st-dt-007")).status).toBe("active"); // archive unticked: kept
      const [added] = await sql`select * from showtime where theater_id='theater-downtown' and movie_title='Kung Fu Panda 4' and start_time='2025-03-15T18:30:00Z'`;
      expect(added?.status).toBe("active");

      // Persisted choices + audit.
      const persisted = byLine((await users.avery.get(`/imports/${d.summary.id}`)).json);
      expect(persisted[3].accepted).toBe(false);
      expect(persisted[2].accepted).toBe(true);
      const [audit] = await sql`select after from audit_log where action='import.apply' and entity_id=${d.summary.id}`;
      expect(audit?.after.rejectedChanges).toBe(1);
      expect(audit?.after.agent).toBe("ok");

      // Re-applying is a no-op that returns the same result.
      const again = await users.avery.post(`/imports/${d.summary.id}/apply`, {});
      expect(again.json.summary.status).toBe("applied");
      expect((await showtime("st-dt-002")).auditorium).toBe("Auditorium 2");

      // Same file again: nothing left to change and the notice says it was applied.
      const repeat = (await users.avery.upload("theater-downtown", "new-drop.csv", sample("new-drop.csv"))).json;
      expect(repeat.summary.notices.join(" ")).toContain("already applied");
    },
    AI_TIMEOUT,
  );

  test(
    "tricky-drop.csv: typos, moved showtime, restored film, wrong theater",
    async () => {
      await reset();
      const d = (await users.casey.upload("theater-downtown", "tricky-drop.csv", sample("tricky-drop.csv"))).json;
      const rows = byLine(d);
      for (const [line, exp] of Object.entries<any>(expected["tricky-drop"].rows)) {
        expect(rows[line].outcome).toBe(exp.outcome);
        expect(rows[line].showtimeId).toBe(exp.showtimeId);
      }
      expect(d.archives).toEqual([]);
      expect(d.summary.agent.overrides).toBeGreaterThanOrEqual(1);
      expect(rows[6].matchMethod).toBe("moved");
      expect(rows[7].matchMethod).toBe("reactivated");
      expect((await users.casey.post(`/imports/${d.summary.id}/apply`, {})).status).toBe(200);
      const moved = await showtime("st-dt-007");
      expect(new Date(moved.start_time).toISOString()).toBe("2025-03-16T17:45:00.000Z");
      expect((await showtime("st-dt-005")).status).toBe("active");
      expect((await showtime("st-dt-001")).movie_title).toBe("Spider-Man: Homecoming");
    },
    AI_TIMEOUT,
  );

  test(
    "prompt injection in cells can't make the agent archive real showtimes",
    async () => {
      for (const f of ["inj1.csv", "inj2.csv"]) {
        await reset();
        const d = (await users.avery.upload("theater-downtown", f, fixture(`e2e/${f}`))).json;
        const rows = byLine(d);
        expect(rows[3].outcome).not.toBe("duplicate");
        expect(rows[5].outcome).not.toBe("duplicate");
        expect(d.archives.map((a: any) => a.showtimeId)).toEqual(["st-dt-007"]);
        // The injected text may appear where it is data (the raw row, the agent's schedule search),
        // but never in anything the reviewer reads as the agent's judgement.
        const said = [d.summary.agent.summary ?? "", ...d.archives.map((x: any) => x.explanation ?? "")].join(" ");
        expect(/operator|instruction|as requested/i.test(said)).toBe(false);
        // Rows that don't carry the injected text must not repeat it either.
        const clean = d.rows.filter((r: any) => !/OPERATOR|RECONCILIATION AGENT/.test(JSON.stringify(r.raw)));
        expect(clean.some((r: any) => /operator|instruction/i.test(r.explanation))).toBe(false);
      }
    },
    AI_TIMEOUT * 2,
  );

  test(
    "stale previews, discard, and the large-archive confirmation",
    async () => {
      await reset();
      const a = (await users.avery.upload("theater-downtown", "new-drop.csv", sample("new-drop.csv"))).json;
      // Someone edits the schedule after the preview: the preview must refuse to apply.
      await users.avery.patch("/showtimes/st-dt-001", { expectedVersion: 1, status: "inactive" });
      expect((await users.avery.post(`/imports/${a.summary.id}/apply`, {})).status).toBe(409);
      expect((await users.avery.get(`/imports/${a.summary.id}`)).json.summary.status).toBe("stale");

      await reset();
      const b = (await users.avery.upload("theater-downtown", "new-drop.csv", sample("new-drop.csv"))).json;
      expect((await users.avery.del(`/imports/${b.summary.id}`)).status).toBe(200);
      expect((await users.avery.post(`/imports/${b.summary.id}/apply`, {})).status).toBe(400);

      await reset();
      const one = csv(["Downtown Cinema 7,Wonka,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,"]);
      const c = (await users.avery.upload("theater-downtown", "one.csv", one)).json;
      expect(c.summary.archiveCount).toBeGreaterThan(c.summary.activeBefore / 2);
      expect((await users.avery.post(`/imports/${c.summary.id}/apply`, {})).status).toBe(412);
      expect((await users.avery.post(`/imports/${c.summary.id}/apply`, { confirmLargeArchive: true })).status).toBe(200);
      const active = await sql`select count(*)::int n from showtime where theater_id='theater-downtown' and status='active'`;
      expect(active[0]!.n).toBe(1);
    },
    AI_TIMEOUT * 3,
  );

  test("bad files fail fast with a readable reason", async () => {
    const cases: [string, string | Uint8Array, RegExp][] = [
      ["empty.csv", "", /empty/i],
      ["header.csv", csv([]), /header/i],
      ["missing.csv", "theater_name,movie_title\nDowntown Cinema 7,Wonka", /column|header/i],
      ["binary.csv", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]), /csv|text|binary/i],
      ["other.csv", csv(["Riverside Multiplex,The Fall Guy,Auditorium A,2025-03-15T19:15:00Z,2025-03-15T21:21:00Z,EN,2D,PG-13,"]), /theater|Riverside/i],
      // No valid row would archive the whole schedule, like a header-only file.
      ["all-rejected.csv", fixture("all-rows-rejected.csv"), /None of the 5 rows can be imported.*Line 2: Unrecognized date\/time/],
    ];
    for (const [name, content, msg] of cases) {
      const r = await users.avery.upload("theater-downtown", name, content);
      expect(r.status).toBe(400);
      expect(String(r.json.message)).toMatch(msg);
    }
  });

  test("messy rows: encoding, delimiter, timezone-less times, rejects", async () => {
    await reset();
    const text = csv([
      "Downtown Cinema 7,Wonka,Auditorium 3,2025-03-20 18:00,2025-03-20 19:56,EN,2D,PG,", // naive local time
      "Downtown Cinema 7,Broken,Auditorium 3,2025-03-20T20:00:00Z,2025-03-20T19:00:00Z,EN,2D,PG,", // end before start
      "Downtown Cinema 7,Café Society,Auditorium 4,2025-03-21T18:00:00Z,2025-03-21T19:40:00Z,eng,4dx,pg13,",
    ]).replace(/,/g, ";");
    const win1252 = Buffer.from(text, "latin1"); // é as a single 0xE9 byte
    const d = (await users.avery.upload("theater-downtown", "messy.csv", win1252)).json;
    expect(d.summary.notices.join(" ")).toMatch(/1252|encoding/i);
    expect(d.summary.notices.join(" ")).toMatch(/;|semicolon|delimiter/i);
    const rows = byLine(d);
    expect(rows[2].startTime).toBe("2025-03-21T01:00:00.000Z"); // 6pm Pacific (PDT)
    expect(rows[3].outcome).toBe("rejected");
    expect(rows[4].movieTitle).toBe("Café Society");
    expect(rows[4].outcome).toBe("add");
  }, AI_TIMEOUT);

  test(
    "a 5,000-row file previews fast and still enforces the rules",
    async () => {
      await reset();
      const lines: string[] = [];
      const start = Date.UTC(2025, 3, 1, 15, 0);
      for (let i = 0; i < 5000; i++) {
        const s = new Date(start + i * 15 * 60_000);
        const e = new Date(s.getTime() + 110 * 60_000);
        lines.push(`Downtown Cinema 7,Film Number ${i % 400},Auditorium ${(i % 6) + 1},${s.toISOString()},${e.toISOString()},EN,2D,PG,`);
      }
      const t0 = Date.now();
      const r = await users.avery.upload("theater-downtown", "big.csv", csv(lines));
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(20_000);
      expect(r.json.summary.addCount).toBe(5000);
      expect(r.json.summary.agent.status).toBe("ok");
    },
    AI_TIMEOUT,
  );

  test("files over 5,000 rows are refused, so the review always shows every row apply would touch", async () => {
    const lines = Array.from({ length: 5001 }, (_, i) => {
      const t = new Date(Date.UTC(2025, 3, 1, 15) + i * 15 * 60_000);
      return `Downtown Cinema 7,Film ${i},Auditorium 1,${t.toISOString()},${new Date(t.getTime() + 6_600_000).toISOString()},EN,2D,PG,`;
    });
    const r = await users.avery.upload("theater-downtown", "too-many.csv", csv(lines));
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("This file has 5,001 rows; the limit is 5,000 per upload. Split it and upload the parts.");
  });

  test("files over 3 MB are refused", async () => {
    const big = "x".repeat(3 * 1024 * 1024 + 10);
    const r = await users.avery.upload("theater-downtown", "huge.csv", big);
    expect([400, 413]).toContain(r.status);
  });

  /* ───────── QA fixes ───────── */

  test(
    "ISO dates with 12-hour times are read, so the drop matches instead of archiving everything",
    async () => {
      await reset();
      const r = await users.avery.upload("theater-downtown", "iso-12h.csv", fixture("iso-12-hour-times.csv"));
      expect(r.status).toBe(200);
      expect(r.json.summary.rejectedCount).toBe(0);
      expect(r.json.archives).toEqual([]);
      expect(byLine(r.json)[2].startTime).toBe("2025-03-15T18:00:00.000Z"); // 11:00 AM Los Angeles
      await users.avery.del(`/imports/${r.json.summary.id}`);
    },
    AI_TIMEOUT,
  );

  test(
    "a row whose time can't be read keeps every showtime of its film off the archive list",
    async () => {
      await reset();
      const file = csv([
        "Downtown Cinema 7,Spider-Man: Homecoming,Auditorium 1,2025-03-15T18:00:00Z,2025-03-15T20:13:00Z,EN,2D,PG-13,",
        "Downtown Cinema 7,Dune: Part Two,Auditorium 1,Saturday afternoon,2025-03-15T22:46:00Z,EN,IMAX,PG-13,",
      ]);
      const d = (await users.avery.upload("theater-downtown", "bad-time.csv", file)).json;
      const archived = d.archives.map((a: any) => a.showtimeId);
      expect(archived).not.toContain("st-dt-003");
      expect(archived).not.toContain("st-dt-004");
      expect(archived).toContain("st-dt-007"); // Kung Fu Panda 4 really is missing
      await users.avery.del(`/imports/${d.summary.id}`);
    },
    AI_TIMEOUT,
  );

  test(
    "a file without format/rating/language columns keeps the stored values",
    async () => {
      await reset();
      const d = (await users.avery.upload("theater-downtown", "no-optional.csv", fixture("no-optional-columns.csv"))).json;
      expect(d.summary.updateCount).toBe(0);
      expect(d.summary.notices).toContain("No rating column: stored ratings are kept; new showtimes get NR.");
      expect((await users.avery.post(`/imports/${d.summary.id}/apply`, {})).status).toBe(200);
      const dune = await showtime("st-dt-003");
      expect([dune.format, dune.rating]).toEqual(["IMAX", "PG-13"]);
    },
    AI_TIMEOUT,
  );

  test(
    "after applying with everything unticked, the import says nothing was applied",
    async () => {
      await reset();
      const one = csv(["Downtown Cinema 7,Wonka Two,Auditorium 3,2025-03-15T16:00:00Z,2025-03-15T17:56:00Z,EN,2D,PG,"]);
      const d = (await users.avery.upload("theater-downtown", "untick.csv", one)).json;
      expect(d.summary.archiveCount).toBeGreaterThan(0);
      const decisions = {
        rows: d.rows.filter((r: any) => r.outcome === "add" || r.outcome === "update").map((r: any) => ({ lineNumber: r.lineNumber, accepted: false })),
        archives: d.archives.map((a: any) => ({ showtimeId: a.showtimeId, accepted: false })),
      };
      const applied = (await users.avery.post(`/imports/${d.summary.id}/apply`, { decisions })).json.summary;
      expect([applied.addCount, applied.updateCount, applied.archiveCount]).toEqual([0, 0, 0]);
      expect(applied.notices.some((n: string) => n.includes("would archive"))).toBe(false);
      const listed = (await users.avery.get("/theaters/theater-downtown/imports")).json.find((i: any) => i.id === d.summary.id);
      expect([listed.addCount, listed.archiveCount]).toEqual([0, 0]);
      const active = await sql`select count(*)::int n from showtime where theater_id='theater-downtown' and status='active'`;
      expect(active[0]!.n).toBe(5);
    },
    AI_TIMEOUT,
  );

  test("a tampered paging cursor is a 400; real cursors page every time sort", async () => {
    await reset();
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const titleCursor = (await users.sam.get("/showtimes?limit=2&sort=movieTitle")).json.nextCursor;
    for (const [sort, cursor] of [
      ["startTime", titleCursor],
      ["startTime", enc(["notadate", "x"])],
      ["movieStatus", enc(["bogus", "x"])],
    ]) {
      const r = await users.sam.get(`/showtimes?sort=${sort}&cursor=${cursor}`);
      expect(r.status).toBe(400);
      expect(r.json.message).toBe("Invalid cursor");
    }
    for (const sort of ["startTime", "endTime", "lastUpdated", "movieStatus"]) {
      const seen: string[] = [];
      let cursor = "";
      for (let i = 0; i < 10; i++) {
        const page = (await users.sam.get(`/showtimes?limit=4&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`)).json;
        seen.push(...page.items.map((x: any) => x.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(new Set(seen).size).toBe(15);
    }
  });

  test("showtime dates outside 2000-2100 or runtimes over a day are a 400, not a 500", async () => {
    const base = { theaterId: "theater-downtown", movieTitle: "Ancient", auditorium: "Aud 1", language: "EN", format: "2D", rating: "PG" };
    const ancient = await users.avery.post("/showtimes", { ...base, startTime: "0001-01-01T10:00:00Z", endTime: "0001-01-01T12:00:00Z" });
    expect(ancient.status).toBe(400);
    expect(JSON.stringify(ancient.json)).toContain("Dates must be between 2000 and 2100");
    const long = await users.avery.post("/showtimes", { ...base, startTime: "2025-05-01T10:00:00Z", endTime: "2025-05-03T12:00:00Z" });
    expect(long.status).toBe(400);
    const edit = await users.avery.patch("/showtimes/st-dt-001", { expectedVersion: 1, endTime: "2025-03-17T20:13:00Z" });
    expect(edit.status).toBe(400);
    expect(edit.json.message).toContain("24 hours");
  });

  test("a viewer adding someone is refused for the right reason", async () => {
    const r = await users.riley.post("/users", {
      name: "Nope",
      email: `e2e-v-${Date.now()}@example.com`,
      memberships: [{ theaterId: "theater-downtown", role: "viewer" }],
    });
    expect(r.status).toBe(403);
    expect(r.json.message).toBe("Only admins of that theater can add or remove people there");
  });

  /* ───────── people and access management ───────── */

  test("people: provisioning rules and guardrails", async () => {
    await reset();
    // An admin can add a viewer to their own theater, not an admin.
    const v = await users.avery.post("/users", { name: "E2E Viewer", email: `e2e-${Date.now()}@example.com`, memberships: [{ theaterId: "theater-downtown", role: "viewer" }] });
    expect(v.status).toBe(200);
    expect(v.json.temporaryPassword.length).toBeGreaterThan(12);
    expect((await users.avery.post("/users", { name: "Nope", email: `e2e-a-${Date.now()}@example.com`, memberships: [{ theaterId: "theater-downtown", role: "admin" }] })).status).toBe(403);
    expect((await users.avery.put("/theaters/theater-downtown/members/user-viewer-riley", { role: "admin" })).status).toBe(403);
    // New user must set a password before anything else.
    const newbie = new Client(v.json.user.email);
    expect((await newbie.login(v.json.temporaryPassword)).status).toBe(200);
    expect((await newbie.get("/me")).json.mustChangePassword).toBe(true);
    expect((await newbie.get("/showtimes")).status).toBe(403);
    expect((await newbie.post("/auth/password", { currentPassword: v.json.temporaryPassword, newPassword: "a-new-strong-password" })).status).toBe(200);
    expect((await newbie.get("/showtimes")).json.total).toBe(5);
    expect((await users.riley.get("/audit")).status).toBe(403);
    // Super admin grants admin; it applies on the very next request.
    expect((await users.sam.put("/theaters/theater-downtown/members/user-viewer-riley", { role: "admin" })).status).toBe(200);
    expect((await users.riley.get("/me")).json.theaterRoles["theater-downtown"]).toBe("admin");
    // Guardrails.
    expect((await users.sam.patch("/users/user-super-sam", { isSuperAdmin: false })).status).toBe(403);
    expect((await users.sam.post("/users/user-viewer-riley/deactivate")).status).toBe(403); // demo account
    expect((await users.jordan.post("/demo/reset")).status).toBe(403);
    await reset();
  });

  /* ───────── invariants after everything ───────── */

  test("database invariants hold", async () => {
    const dupes = await sql`select theater_id, movie_title_key, start_time, count(*) from showtime where status='active' group by 1,2,3 having count(*) > 1`;
    expect(dupes.length).toBe(0);
    const badTimes = await sql`select id from showtime where end_time <= start_time`;
    expect(badTimes.length).toBe(0);
    // The app role cannot rewrite history.
    const app = postgres(process.env.E2E_APP_DB ?? "postgresql://scope_app:scope_app_dev@localhost:5432/scope_showtimes", { max: 1, onnotice: () => undefined });
    let denied = false;
    try {
      await app.unsafe("delete from audit_log");
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
    const counted = await app.unsafe("select count(*)::int as n from showtime");
    expect(counted[0]!.n).toBe(0); // RLS: no user context, no rows
    await app.end({ timeout: 2 });
  });
});
