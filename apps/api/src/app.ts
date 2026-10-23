import { trpcServer } from "@hono/trpc-server";
import { Scalar } from "@scalar/hono-api-reference";
import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
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

/**
 * Client IP for rate limiting and audit, from sources a client can't forge:
 * on Vercel, the headers its edge sets; on the Bun server, the socket address
 * (Bun passes the server as the app's env). x-forwarded-for is never trusted.
 */
function clientIp(c: Context): string {
  if (process.env.VERCEL) {
    const ip = c.req.header("x-real-ip") ?? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const server = c.env as { requestIP?: (req: Request) => { address: string } | null } | undefined;
  return server?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

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
    createContext: (opts, c) => createContext({ req: opts.req, resHeaders: opts.resHeaders, ip: clientIp(c) }),
  }),
);

const restContext =
  (ip: string) =>
  ({ req, res }: { req: Request; res: { setHeader: (k: string, v: string[]) => void } }) =>
    createContext({ req, resHeaders: { append: (k, v) => res.setHeader(k, [v]) }, ip });

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
    createContext: restContext(clientIp(c)) as never,
  }),
);
