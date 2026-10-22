import { z } from "zod";

/** Optional secret where an empty string means "not set". */
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length >= 10 ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.url(),
  MIGRATION_DATABASE_URL: z.url().optional(),
  PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SEED_PASSWORD: z.string().min(12).default("showtimes-dev-pass"),
  /** Model for the reconciliation agent, as an AI Gateway id ("provider/model"). */
  AI_MODEL: z.string().min(3).default("google/gemini-3-flash"),
  /** Whole agent run budget, in ms. Past it, the rules decide. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
  /** Gemini thinking effort for the agent. */
  AI_THINKING: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  /** Optional: call Gemini directly instead of through the gateway. */
  GEMINI_API_KEY: optionalSecret,
  /**
   * Optional Gemini API model id for the direct path. Unset, it follows AI_MODEL:
   * "google/gemini-3-flash" becomes "gemini-3-flash-preview", the Gemini API's name for it.
   */
  GEMINI_MODEL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  AI_GATEWAY_API_KEY: optionalSecret,
  VERCEL_OIDC_TOKEN: optionalSecret,
  /** Public demo: show the seeded one-click logins and protect those accounts from lockout. */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
export const showDemoAccounts = !isProd || env.DEMO_MODE;
