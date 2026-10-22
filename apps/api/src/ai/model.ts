import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { env } from "../env";

export interface ResolvedModel {
  model: LanguageModel;
  /** Human-readable id stored with each import, e.g. "google/gemini-3-flash via AI Gateway". */
  label: string;
}

/**
 * Picks the agent's model. GEMINI_API_KEY → Google directly. Otherwise Vercel AI
 * Gateway, which authenticates with AI_GATEWAY_API_KEY or, on Vercel, the
 * project's OIDC token. No credential → null, and the rules decide alone.
 */
export function resolveModel(id: string = env.AI_MODEL): ResolvedModel | null {
  if (env.GEMINI_API_KEY && id.startsWith("google/")) {
    const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
    const name = id.slice("google/".length);
    return { model: google(name), label: `${name} (Gemini API)` };
  }
  if (env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || process.env.VERCEL) {
    return { model: id, label: `${id} via AI Gateway` };
  }
  return null;
}
