# Hainbuch Technical Advisor

Local AI advisor for CNC workholding + manufacturing planning. Runs fully
offline: LM Studio for the LLM, the Engineering-RAG project for grounded
catalogue/Tabellenbuch context, and deterministic ISO-formula calculations
in code (the model never invents numbers).

## Pipeline

1. **Material** — retrieval from Fachkunde/Tabellenbuch → LLM picks material
   group + norm raw stock (strict JSON via LM Studio `json_schema`).
2. **Arbeitsplan + Spannmittel** — retrieval from the real Hainbuch catalogue
   → LLM plans operations (Drehen/Fräsen/Bohren/Senken/Reiben/Gewindebohren)
   with tool, ∅, Schnittweg, passes, vc, f/fz.
3. **Calculation (code, not LLM)** — `machining.ts` clamps cutting values to
   material Richtwerte and computes n = vc·1000/(π·D), vf = n·f (·z),
   t = L/vf per operation, plus totals. Thread pitch comes from DIN 13.

## Run

Prerequisites:
- LM Studio running on `localhost:1234` with the model from `.env` loaded
- Optional but recommended — the retrieval API:
  `/Users/lorenc/mlx-env/bin/python /Users/lorenc/Desktop/Engineering-RAG/scripts/rag_api.py`
  (without it the advisor still works, just without catalogue grounding)

```bash
npm install
cp .env.example .env   # adjust MODEL_ID etc.
npm run dev            # http://localhost:3000
```

## Config (.env)

| Var | Default | |
|---|---|---|
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | OpenAI-compatible endpoint |
| `MODEL_ID` | `agents-a1-mlx-oq8` | loaded LM Studio model |
| `RAG_API_URL` | `http://127.0.0.1:7777` | Engineering-RAG retrieval API |
| `MAX_RPM` | `8000` | spindle limit for time calculation |
