/**
 * Compares models on the sample drops: parse -> rules -> agent -> verify,
 * against the seeded Downtown schedule, scored on test/fixtures/csv/agent-expected.json.
 *
 *   bun src/scripts/eval-agent.ts [runs] [model ...]
 */
import { readFileSync } from "node:fs";
import { runReconciliationAgent } from "../ai/agent";
import { resolveModel } from "../ai/model";
import { existingForFile, fixtureExisting } from "../ai/testing/fixture-existing";
import { mergeAgentReview } from "../ai/verify";
import { parseShowtimeCsv, reconcile } from "../csv";

const TZ = "America/Los_Angeles";
const runs = Number(process.argv[2] ?? 2);
const models = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["google/gemini-3-flash", "google/gemini-2.5-flash-lite", "anthropic/claude-haiku-5.5"];
const expected = JSON.parse(readFileSync(new URL("../../test/fixtures/csv/agent-expected.json", import.meta.url), "utf8")) as Record<
  string,
  { rows: Record<string, { outcome: string; showtimeId: string | null }>; archives: string[] }
>;

const samples = ["new-drop", "tricky-drop"].map((name) => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../../../sample-data/${name}.csv`, import.meta.url)));
  const parsed = parseShowtimeCsv(bytes, { theaterName: "Downtown Cinema 7", timezone: TZ, now: new Date("2025-03-01") });
  const existing = existingForFile(fixtureExisting("theater-downtown"), parsed.rows.flatMap((r) => (r.value ? [r.value.startTime] : [])));
  return { name, rules: reconcile(parsed.rows, existing), existing };
});

type Score = { correct: number; total: number; corrections: number; ms: number[]; inTok: number; outTok: number; fails: number; misses: string[] };

for (const id of models) {
  const resolved = resolveModel(id);
  if (!resolved) throw new Error("No AI credential: set VERCEL_OIDC_TOKEN, AI_GATEWAY_API_KEY or GEMINI_API_KEY");
  const score: Score = { correct: 0, total: 0, corrections: 0, ms: [], inTok: 0, outTok: 0, fails: 0, misses: [] };
  for (let run = 0; run < runs; run++) {
    for (const s of samples) {
      const out = await runReconciliationAgent(resolved, { theater: { name: "Downtown Cinema 7", timezone: TZ }, reconciled: s.rules, existing: s.existing });
      score.ms.push(out.durationMs);
      score.inTok += out.usage.inputTokens;
      score.outTok += out.usage.outputTokens;
      if (out.status !== "ok") {
        score.fails++;
        score.misses.push(`${s.name}: agent failed (${out.error})`);
      }
      const m = mergeAgentReview(s.rules, out.review, s.existing, { timezone: TZ });
      score.corrections += m.corrections;
      const exp = expected[s.name]!;
      for (const r of m.rows) {
        const e = exp.rows[String(r.lineNumber)];
        score.total++;
        if (e && e.outcome === r.outcome && e.showtimeId === r.showtimeId) score.correct++;
        else score.misses.push(`${s.name} line ${r.lineNumber}: got ${r.outcome}/${r.showtimeId} (${r.decisionSource})`);
      }
      score.total++;
      if (JSON.stringify(m.archives.map((a) => a.showtime.id).sort()) === JSON.stringify([...exp.archives].sort())) score.correct++;
      else score.misses.push(`${s.name}: archives ${m.archives.map((a) => a.showtime.id).join(",")}`);
    }
  }
  const avg = Math.round(score.ms.reduce((a, b) => a + b, 0) / score.ms.length);
  console.log(
    `${id.padEnd(32)} accuracy ${score.correct}/${score.total}  corrections ${score.corrections}  failures ${score.fails}  avg ${avg}ms  max ${Math.max(...score.ms)}ms  tokens in/out per drop ${Math.round(score.inTok / score.ms.length)}/${Math.round(score.outTok / score.ms.length)}`,
  );
  for (const miss of [...new Set(score.misses)].slice(0, 6)) console.log(`    ${miss}`);
}
