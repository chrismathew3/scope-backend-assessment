import { describe, expect, test } from "bun:test";
import { parseShowtimeCsv, reconcile } from "../csv";
import { runReconciliationAgent } from "./agent";
import { geminiApiId, type ResolvedModel } from "./model";

const TZ = "America/Los_Angeles";

describe("runReconciliationAgent", () => {
  test("a big all-new drop makes no model call and says so", async () => {
    const header = "theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated";
    const lines = Array.from({ length: 130 }, (_, i) => {
      const start = new Date(Date.UTC(2025, 3, 1, 12) + i * 3_600_000);
      const end = new Date(start.getTime() + 2 * 3_600_000);
      return `Downtown Cinema 7,Film ${i},Auditorium 1,${start.toISOString()},${end.toISOString()},EN,2D,PG,`;
    });
    const parsed = parseShowtimeCsv(new TextEncoder().encode([header, ...lines].join("\n")), { theaterName: "Downtown Cinema 7", timezone: TZ });
    // The model must never be touched.
    const resolved = { model: null, label: "test" } as unknown as ResolvedModel;
    const out = await runReconciliationAgent(resolved, { theater: { name: "Downtown Cinema 7", timezone: TZ }, reconciled: reconcile(parsed.rows, []), existing: [] });
    expect(out.status).toBe("ok");
    expect(out.durationMs).toBeNull();
    expect(out.summary).toBe("No rows needed judgement; the rules decided every row.");
    expect(out.review?.delegated).toEqual([]);
  });
});

describe("geminiApiId", () => {
  test("maps the gateway's Gemini 3 Flash id to the Gemini API's preview id", () => {
    expect(geminiApiId("gemini-3-flash")).toBe("gemini-3-flash-preview");
    expect(geminiApiId("gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
  });
});
