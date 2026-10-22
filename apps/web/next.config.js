/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 */
import { env } from "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // The API and shared packages ship as TypeScript source.
  transpilePackages: ["@scope/api", "@scope/shared"],
  // Loaded from node_modules (not bundled) so trpc-to-openapi and our schemas share one Zod instance.
  serverExternalPackages: ["postgres", "zod", "zod-openapi", "trpc-to-openapi", "@trpc/server"],
  // Locally (API_URL set) /trpc and /api are proxied to the Bun API server.
  // On Vercel API_URL is unset and src/app/{trpc,api} route handlers run the API in-process.
  async rewrites() {
    if (!env.API_URL) return [];
    return {
      beforeFiles: [
        { source: "/trpc/:path*", destination: `${env.API_URL}/trpc/:path*` },
        { source: "/api/:path*", destination: `${env.API_URL}/api/:path*` },
      ],
    };
  },
};

export default config;
