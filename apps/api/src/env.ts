import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  MIGRATION_DATABASE_URL: z.url().optional(),
  PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SEED_PASSWORD: z.string().min(12).default("showtimes-dev-pass"),
  /** Public demo: show the seeded one-click logins and protect those accounts from lockout. */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
export const showDemoAccounts = !isProd || env.DEMO_MODE;
