import { Agent, setGlobalDispatcher } from "undici";
import { z } from "zod";
import "dotenv/config";

// Soft env validation: coerce + defaults, log issues, never crash on missing
// optional vars (local LM Studio / RAG may be offline during boot).
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LMSTUDIO_URL: z.string().url().default("http://localhost:1234/v1"),
  MODEL_ID: z.string().min(1).default("agents-a1-mlx-oq8"),
  FAST_MODEL_ID: z.string().min(1).optional(),
  RAG_API_URL: z.string().url().default("http://127.0.0.1:7777"),
  MAX_RPM: z.coerce.number().positive().default(8000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  LLM_JSON_OBJECT: z.string().optional(),
  APP_KEY: z.string().optional(),
  ADMIN_KEY: z.string().optional(),
  RATE_MAX_PER_HOUR: z.coerce.number().int().positive().optional(),
  RATE_MAX_PER_DAY: z.coerce.number().int().positive().optional(),
  TRUST_LOOPBACK: z.enum(["0", "1"]).optional(),
  ALLOW_REMOTE_ADMIN: z.enum(["0", "1"]).optional(),
  CHAT_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(256 * 1024),
});

function loadEnv() {
  const full = EnvSchema.safeParse(process.env);
  if (full.success) return full.data;

  console.warn(
    "[config] env validation issues — merging defaults for bad fields:",
    full.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
  );

  // Keep good fields: re-parse after dropping keys that failed.
  const bad = new Set(full.error.issues.map((i) => String(i.path[0] ?? "")));
  const cleaned: Record<string, unknown> = { ...process.env };
  for (const k of bad) delete cleaned[k];
  const retry = EnvSchema.safeParse(cleaned);
  if (retry.success) return retry.data;
  return EnvSchema.parse({});
}

const env = loadEnv();

export const PORT = env.PORT;
export const LMSTUDIO_URL = env.LMSTUDIO_URL;
export const MODEL_ID = env.MODEL_ID;
// Fast model for trivial calls (intent classification, translations).
export const FAST_MODEL_ID = env.FAST_MODEL_ID || MODEL_ID;
export const RAG_API_URL = env.RAG_API_URL;
export const MAX_RPM = env.MAX_RPM;
export const LLM_TIMEOUT_MS = env.LLM_TIMEOUT_MS;
// Gemini via VibeProxy ignores strict json_schema — use json_object + schema hint instead.
export const CHAT_BODY_LIMIT_BYTES = env.CHAT_BODY_LIMIT_BYTES;
export const BODY_LIMIT_BYTES = env.BODY_LIMIT_BYTES;
export const USE_JSON_OBJECT =
  env.LLM_JSON_OBJECT === "1" ||
  LMSTUDIO_URL.includes(":8317") ||
  MODEL_ID.toLowerCase().includes("gemini");

// Local LLM generations can take many minutes — lift undici's default
// 300 s headers timeout for all fetch calls.
setGlobalDispatcher(
  new Agent({ headersTimeout: LLM_TIMEOUT_MS, bodyTimeout: LLM_TIMEOUT_MS })
);
