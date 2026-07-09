import { RAG_API_URL } from "./config";

export interface RagChunk {
  text: string;
  header: string;
  label: string;
  score: number;
}

export async function ragRetrieve(
  query: string,
  collections: string[] | null,
  limit = 5
): Promise<{ context: string; chunks: RagChunk[] }> {
  try {
    const res = await fetch(`${RAG_API_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ query, collections, limit }),
    });
    if (!res.ok) throw new Error(`RAG API ${res.status}`);
    const data = await res.json();
    return { context: data.context || "", chunks: data.chunks || [] };
  } catch (err: any) {
    console.warn(`[RAG] retrieval unavailable (${err.message}) — continuing without context`);
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
    solutions.push({
      designation: m[1],
      fitType: m[2],
      holeGo: num(m[3]),
      holeGu: num(m[4]),
      shaftGo: num(m[5]),
      shaftGu: num(m[6]),
      psh: num(m[7]),
      puh: num(m[8]),
    });
  }
  return solutions;
}
