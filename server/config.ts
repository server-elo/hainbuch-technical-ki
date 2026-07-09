import { Agent, setGlobalDispatcher } from "undici";
import "dotenv/config";

export const PORT = Number(process.env.PORT || 3000);
export const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://localhost:1234/v1";
export const MODEL_ID = process.env.MODEL_ID || "agents-a1-mlx-oq8";
export const RAG_API_URL = process.env.RAG_API_URL || "http://127.0.0.1:7777";
export const MAX_RPM = Number(process.env.MAX_RPM || 8000);
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 900000);
// Gemini via VibeProxy ignores strict json_schema — use json_object + schema hint instead.
export const USE_JSON_OBJECT =
  process.env.LLM_JSON_OBJECT === "1" ||
  LMSTUDIO_URL.includes(":8317") ||
  MODEL_ID.toLowerCase().includes("gemini");

// Local LLM generations can take many minutes — lift undici's default
// 300 s headers timeout for all fetch calls.
setGlobalDispatcher(
  new Agent({ headersTimeout: LLM_TIMEOUT_MS, bodyTimeout: LLM_TIMEOUT_MS })
);
