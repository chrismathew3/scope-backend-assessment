import { DemoResetOutput } from "@scope/shared";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { auditoriumKey, cleanText, titleKey } from "../../csv";
import { fixtures } from "../../db/fixtures";
import { env } from "../../env";
import { audit } from "../../services/audit";
import { authedProcedure, router } from "../init";

/** The seeded fixture in the shape app_demo_reset() expects. */
function demoPayload() {
  return {
    theaters: fixtures.theaters,
    users: fixtures.users.map((u) => ({
      id: u.id,
      name: u.name,
      isSuperAdmin: u.isSuperAdmin ?? false,
      memberships: u.memberships,
    })),
    showtimes: fixtures.showtimes.map((s) => {
      const title = cleanText(s.movieTitle);
      return {
        id: s.id,
        theater_id: s.theaterId,
        movie_title: title,
        movie_title_key: titleKey(title),
        movie_status: s.movieStatus,
        auditorium: s.auditorium,
        auditorium_key: auditoriumKey(s.auditorium),
        start_time: s.startTime,
        end_time: s.endTime,
        language: s.language,
        format: s.format,
        rating: s.rating,
        status: s.status,
        source_updated_at: s.lastUpdated,
        archived_at: s.status === "archived" ? s.lastUpdated : null,
        updated_at: s.lastUpdated,
      };
    }),
  };
}

export const demoRouter = router({
  /** Public demo only: put the seeded schedule and demo accounts back so the next reviewer starts clean. */
  reset: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/demo/reset",
        tags: ["demo"],
        protect: true,
        summary: "Restore the seeded demo data (demo deployments only)",
      },
    })
    .input(z.object({}).optional())
    .output(DemoResetOutput)
    .mutation(async ({ ctx }) => {
      if (!env.DEMO_MODE) throw new TRPCError({ code: "FORBIDDEN", message: "Demo reset is only available on the demo" });
      // Everyone shares the demo, so only a super admin can wipe it (sign in as Sam Super).
      if (!ctx.principal.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Only a super admin can reset the demo" });
      const [row] = await ctx.tx.execute<{ result: { showtimes: number; imports: number } }>(
        sql`select app_demo_reset(${JSON.stringify(demoPayload())}::jsonb) as result`,
      );
      const result = row?.result ?? { showtimes: 0, imports: 0 };
      await audit(ctx, { action: "demo.reset", entityType: "demo", entityId: "seed", after: result });
      return result;
    }),
});
