import { describe, expect, test } from "bun:test";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { parseShowtimeCsv, reconcile, titleKey } from "../csv";
import type { ExistingShowtime } from "../csv/types";
import { env } from "../env";
import { rowsForAgent, runReconciliationAgent } from "./agent";
import { geminiApiId, type ResolvedModel } from "./model";
import { mergeAgentReview } from "./verify";

const TZ = "America/Los_Angeles";
const THEATER = { name: "Downtown Cinema 7", timezone: TZ };
const HEADER = "theater_name,movie_title,auditorium,start_time,end_time,language,format,rating,last_updated";

/** n rows of distinct new films, an hour apart. */
function newFilms(n: number, title = (i: number) => `Film ${i}`): string[] {
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(Date.UTC(2025, 3, 1, 12) + i * 3_600_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    return `Downtown Cinema 7,${title(i)},Auditorium 1,${start.toISOString()},${end.toISOString()},EN,2D,PG,`;
  });
}

function input(lines: string[], existing: ExistingShowtime[] = []) {
  const parsed = parseShowtimeCsv(new TextEncoder().encode([HEADER, ...lines].join("\n")), { theaterName: THEATER.name, timezone: TZ, now: new Date("2025-03-01") });
  return { theater: THEATER, reconciled: reconcile(parsed.rows, existing), existing };
}

/** The rows a batch prompt carries. */
function promptRows(options: LanguageModelV4CallOptions): { line: number; rulesGuess: { action: string; showtimeId: string | null } }[] {
  const user = options.prompt.find((m) => m.role === "user")!;
  const part = (user.content as { type: string; text?: string }[]).find((p) => p.type === "text")!;
  return JSON.parse(part.text!).rows;
}

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };

function submit(input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "tool-call", toolCallId: `call-${Math.random()}`, toolName: "submitReview", input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  };
}

/** A model that agrees with the rules on every row it is sent. */
const agreeWithRules = (options: LanguageModelV4CallOptions) =>
  submit({
    rows: promptRows(options).map((r) => ({
      line: r.line,
      action: r.rulesGuess.action,
      showtimeId: r.rulesGuess.showtimeId,
      duplicateOfLine: null,
      confidence: 0.9,
      explanation: "Agrees with the rules.",
    })),
  });

const resolvedWith = (doGenerate: (o: LanguageModelV4CallOptions) => Promise<LanguageModelV4GenerateResult>) => {
  const model = new MockLanguageModelV4({ doGenerate });
  return { resolved: { model, label: "mock" } as ResolvedModel, model };
};

describe("runReconciliationAgent", () => {
  test("a big all-new drop makes no model call and says so", async () => {
    // The model must never be touched.
    const resolved = { model: null, label: "test" } as unknown as ResolvedModel;
    const out = await runReconciliationAgent(resolved, input(newFilms(130)));
    expect(out.status).toBe("ok");
    expect(out.durationMs).toBeNull();
    expect(out.trace[0]!.detail).toBe("No rows needed judgement; the rules decided every row.");
    expect(out.review?.delegated).toEqual([]);
  });

  test("splits rows into batches of 40, runs them, and adds up token usage", async () => {
    const { resolved, model } = resolvedWith(async (o) => agreeWithRules(o));
    const out = await runReconciliationAgent(resolved, input(newFilms(90)));
    expect(model.doGenerateCalls.map((c) => promptRows(c).length)).toEqual([40, 40, 10]);
    expect(out.status).toBe("ok");
    expect(out.review!.rows).toHaveLength(90);
    expect(out.review!.delegated).toHaveLength(90);
    expect(out.usage).toEqual({ inputTokens: 300, outputTokens: 30 });
  });

  test("a failed batch is retried once", async () => {
    let failedOnce = false;
    const { resolved, model } = resolvedWith(async (o) => {
      if (!failedOnce && promptRows(o)[0]!.line === 2) {
        failedOnce = true;
        throw new Error("gateway 503");
      }
      return agreeWithRules(o);
    });
    const out = await runReconciliationAgent(resolved, input(newFilms(50)));
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(out.status).toBe("ok");
    expect(out.review!.delegated).toHaveLength(50);
    expect(out.trace.some((t) => t.label.includes("(retry)"))).toBe(true);
  });

  test("a batch that fails twice is left to the rules; the other batch still counts", async () => {
    const { resolved } = resolvedWith(async (o) => {
      if (promptRows(o)[0]!.line === 2) throw new Error("gateway 503");
      return agreeWithRules(o);
    });
    const inp = input(newFilms(50));
    const out = await runReconciliationAgent(resolved, inp);
    expect(out.status).toBe("ok");
    expect(out.review!.delegated).toEqual(Array.from({ length: 10 }, (_, i) => 42 + i));
    expect(out.trace.some((t) => t.label === "The rules decided 40 rows the agent couldn't finish")).toBe(true);
    // The rows the agent didn't finish are the rules' to decide, not corrections.
    const m = mergeAgentReview(inp.reconciled, out.review, inp.existing, { timezone: TZ });
    expect(m.corrections).toBe(0);
    expect(m.rows.filter((r) => r.decisionSource === "ai")).toHaveLength(10);
  });

  test("past the time limit the agent gives up and the rules decide", async () => {
    const before = env.AI_TIMEOUT_MS;
    env.AI_TIMEOUT_MS = 150;
    try {
      const { resolved } = resolvedWith(
        (o) =>
          new Promise((_, reject) => {
            o.abortSignal?.addEventListener("abort", () => reject(o.abortSignal?.reason ?? new Error("aborted")));
          }),
      );
      const out = await runReconciliationAgent(resolved, input(newFilms(5)));
      expect(out.status).toBe("fallback");
      expect(out.review).toBeNull();
      expect(out.error).toBe("The agent took longer than 0s");
    } finally {
      env.AI_TIMEOUT_MS = before;
    }
  });

  test("a malformed or missing review fails the batch, and the rules decide", async () => {
    const malformed = resolvedWith(async () => submit({ rows: "not a list" }));
    const out = await runReconciliationAgent(malformed.resolved, input(newFilms(3)));
    expect(out.status).toBe("fallback");
    expect(out.review).toBeNull();

    const noTool = resolvedWith(async () => ({
      content: [{ type: "text", text: "All good!" }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }));
    const out2 = await runReconciliationAgent(noTool.resolved, input(newFilms(3)));
    expect(out2.status).toBe("fallback");
    expect(out2.error).toBe("The agent stopped without submitting a review");
  });

  test("decisions for lines outside the batch are dropped", async () => {
    const { resolved } = resolvedWith(async (o) => {
      const r = agreeWithRules(o);
      const sent = JSON.parse((r.content[0] as { input: string }).input);
      sent.rows.push({ line: 999, action: "add", showtimeId: null, duplicateOfLine: null, confidence: 1, explanation: "x" });
      return submit(sent);
    });
    const out = await runReconciliationAgent(resolved, input(newFilms(3)));
    expect(out.review!.rows.map((r) => r.line)).toEqual([2, 3, 4]);
  });

  test("rejected rows and rule duplicates are never sent; search isn't offered when the schedule is inline", async () => {
    const { resolved, model } = resolvedWith(async (o) => agreeWithRules(o));
    const [a, b] = newFilms(2);
    await runReconciliationAgent(resolved, input([a!, a!, b!.replace("Auditorium 1", ""), "Riverside Multiplex,X,Auditorium 1,2025-04-01T12:00:00Z,2025-04-01T14:00:00Z,EN,2D,PG,"]));
    const call = model.doGenerateCalls[0]!;
    expect(promptRows(call).map((r) => r.line)).toEqual([2]);
    expect((call.tools ?? []).map((t) => t.name)).toEqual(["submitReview"]);
  });
});

describe("rowsForAgent", () => {
  test("above 120 rows, only rows a verified match could change are sent", () => {
    const start = new Date(Date.UTC(2025, 3, 1, 12));
    const stored: ExistingShowtime = {
      id: "s",
      movieTitle: "Spider-Man: Homecoming",
      movieTitleKey: titleKey("Spider-Man: Homecoming"),
      auditorium: "Auditorium 1",
      startTime: start,
      endTime: new Date(start.getTime() + 2 * 3_600_000),
      language: "EN",
      format: "2D",
      rating: "PG",
      status: "active",
      sourceUpdatedAt: null,
    };
    // Row 2 is a heavy typo of the stored film at its start; the other 129 are unrelated new films
    // (one of them, "Film 1", sits an hour later, a time-only candidate).
    const lines = newFilms(130, (i) => (i === 0 ? "Spidermn Homecomin" : `Film ${i}`));
    const sent = rowsForAgent(input(lines, [stored]));
    expect(sent.map((r) => r.lineNumber)).toEqual([2]);
  });
});

describe("geminiApiId", () => {
  test("maps the gateway's Gemini 3 Flash id to the Gemini API's preview id", () => {
    expect(geminiApiId("gemini-3-flash")).toBe("gemini-3-flash-preview");
    expect(geminiApiId("gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
  });
});
