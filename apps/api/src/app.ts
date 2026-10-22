import { trpcServer } from "@hono/trpc-server";
import { Scalar } from "@scalar/hono-api-reference";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { createOpenApiFetchHandler } from "trpc-to-openapi";
import { db } from "./db/client";
import { env } from "./env";
import { openApiDocument } from "./openapi";
import { createContext } from "./trpc/init";
import { appRouter } from "./trpc/router";

export const app = new Hono();

app.use(logger());
app.use(secureHeaders({ crossOriginResourcePolicy: false }));
app.use(bodyLimit({ maxSize: 5 * 1024 * 1024 })); // 3 MB CSV + base64 overhead

/**
 * CSRF guard. Cookies are SameSite=Lax, and on top of that any state-changing
 * request that names an Origin must come from this site (or the configured web app).
 */
app.use(async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin) {
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch {
      sameSite = false;
    }
    if (!sameSite && origin !== env.WEB_ORIGIN) return c.json({ error: "Cross-origin request blocked" }, 403);
  }
  await next();
});

// The web app proxies through Next, which sets x-forwarded-for.
const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

const health = async (c: { json: (v: unknown) => Response }) => {
  await db.execute(sql`select 1`);
  return c.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
};
app.get("/health", health);
app.get("/api/health", health);

// Typed API used by the web app.
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    endpoint: "/trpc",
    createContext: (opts) => createContext({ req: opts.req, resHeaders: opts.resHeaders, ip: clientIp(opts.req) }),
  }),
);

const restContext = ({ req, res }: { req: Request; res: { setHeader: (k: string, v: string[]) => void } }) =>
  createContext({ req, resHeaders: { append: (k, v) => res.setHeader(k, [v]) }, ip: clientIp(req) });

// Same procedures as REST, generated from the same Zod schemas.
app.get("/api/openapi.json", (c) => c.json(openApiDocument));
app.get("/api/docs", Scalar({ url: "/api/openapi.json", pageTitle: "Showtimes API" }));
app.all("/api/v1/*", (c) =>
  createOpenApiFetchHandler({
    endpoint: "/api/v1",
    router: appRouter,
    req: c.req.raw,
    // At runtime this adapter passes a Node-style `res` (its types say otherwise), so
    // give the context the same append() the tRPC adapter provides.
    createContext: restContext as never,
  }),
);
