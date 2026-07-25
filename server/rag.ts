import { z } from "zod";

import { RAG_API_URL } from "./config";
import { clientAborted, requestSignal } from "./abort";

export interface RagChunk {
  text: string;
  header: string;
  label: string;
  score: number;
}

const RagChunkSchema = z.object({
  text: z.string().default(""),
  header: z.string().default(""),
  label: z.string().default(""),
  score: z.coerce.number().default(0),
});

const RagRetrieveSchema = z.object({
  context: z.string().default(""),
  chunks: z.array(RagChunkSchema).default([]),
});

export async function ragRetrieve(
  query: string,
  collections: string[] | null,
  limit = 5
): Promise<{ context: string; chunks: RagChunk[] }> {
  try {
    const res = await fetch(`${RAG_API_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: requestSignal(60000),
      body: JSON.stringify({ query, collections, limit }),
    });
    if (!res.ok) throw new Error(`RAG API ${res.status}`);
    const raw = await res.json();
    const data = RagRetrieveSchema.safeParse(raw);
    if (!data.success) {
      console.warn("[RAG] response failed schema validation — using empty context");
      return { context: "", chunks: [] };
    }
    return {
      context: data.data.context,
      chunks: data.data.chunks.map((c) => ({
        text: c.text,
        header: c.header,
        label: c.label,
        score: c.score,
      })),
    };
  } catch (err: any) {
    if (clientAborted()) throw err;
    console.warn(
      `[RAG] retrieval unavailable (${err.message}) — continuing without context`
    );
    return { context: "", chunks: [] };
  }
}

export interface FitSolution {
  designation: string;
  fitType: string;
  holeGo: number;
  holeGu: number;
  shaftGo: number;
  shaftGu: number;
  psh: number;
  puh: number;
}

const FitSolutionSchema = z.object({
  designation: z.string().min(1),
  fitType: z.string().min(1),
  holeGo: z.number().finite(),
  holeGu: z.number().finite(),
  shaftGo: z.number().finite(),
  shaftGu: z.number().finite(),
  psh: z.number().finite(),
  puh: z.number().finite(),
});

const num = (s: string) => parseFloat(s.replace(",", "."));

/** Parse the deterministic FERTIGE LÖSUNG block into structured fit data. */
export function parseFitSolutions(context: string): FitSolution[] {
  const block = context.match(/## FERTIGE LÖSUNG[\s\S]*?(?=\n---\n### \[|$)/);
  if (!block) return [];
  const solutions: FitSolution[] = [];
  const re =
    /### Passung (∅\d+ \S+\/\S+) — (\S+) \(berechnet\)\nBohrung [^:]*: G_oB = ([\d,.]+) mm, G_uB = ([\d,.]+) mm\nWelle [^:]*: G_oW = ([\d,.]+) mm, G_uW = ([\d,.]+) mm\nP_SH.* = (-?[\d,.]+) mm\nP_ÜH.* = (-?[\d,.]+) mm/g;
  let m;
  while ((m = re.exec(block[0])) !== null) {
    const candidate = {
      designation: m[1],
      fitType: m[2],
      holeGo: num(m[3]),
      holeGu: num(m[4]),
      shaftGo: num(m[5]),
      shaftGu: num(m[6]),
      psh: num(m[7]),
      puh: num(m[8]),
    };
    const parsed = FitSolutionSchema.safeParse(candidate);
    if (parsed.success) solutions.push(parsed.data);
    else
      console.warn(
        "[RAG] skipped invalid fit solution parse:",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
  }
  return solutions;
}
