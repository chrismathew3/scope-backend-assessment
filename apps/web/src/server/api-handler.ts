import "server-only";
import { app } from "@scope/api/app";

/**
 * Runs the Hono API inside Next (used on Vercel). Locally, when API_URL is
 * set, next.config.js proxies to the standalone Bun server instead.
 */
export const handleApi = (req: Request) => app.fetch(req);
