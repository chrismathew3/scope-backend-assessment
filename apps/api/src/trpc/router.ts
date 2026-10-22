import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { router } from "./init";
import { auditRouter } from "./routers/audit";
import { authRouter, meRouter } from "./routers/auth";
import { importsRouter } from "./routers/imports";
import { showtimesRouter } from "./routers/showtimes";
import { theatersRouter } from "./routers/theaters";
import { membershipsRouter, usersRouter } from "./routers/users";

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  theaters: theatersRouter,
  showtimes: showtimesRouter,
  imports: importsRouter,
  users: usersRouter,
  memberships: membershipsRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
