/** Local/standalone server (Bun). On Vercel the same app runs inside Next route handlers. */
import { app } from "./app";
import { purgeExpiredSessions } from "./auth/session";
import { env } from "./env";

setInterval(() => void purgeExpiredSessions().catch(() => undefined), 60 * 60 * 1000);

console.log(`api listening on http://localhost:${env.PORT}`);
export default { port: env.PORT, fetch: app.fetch };
