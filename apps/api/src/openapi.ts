import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "./trpc/router";

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: "Theater Showtimes API",
  version: "1.0.0",
  description:
    "Every endpoint mirrors a tRPC procedure and shares its Zod schema. Sign in with POST /auth/login; the session cookie authenticates the rest.",
  baseUrl: "/api/v1",
  securitySchemes: {
    sessionCookie: { type: "apiKey", in: "cookie", name: "scope_session" },
  },
});
