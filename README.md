# HAINBUCH Technical Advisor

AI manufacturing advisor: material selection, Arbeitsplan with ISO-calculated
times, ISO 286 fit analysis and clamping recommendations from the real
HAINBUCH catalogue. The model reads and explains — **all numbers are computed
or looked up deterministically in code**, never invented.

Live: https://hainbuchki.web.app (Firebase Hosting → Cloudflare tunnel → this server)

## Layout

```
server/         Node backend (Express, port 3000)
  server.ts       HTTP endpoints, rate limiting, app-key auth
  pipeline.ts     multi-stage advisor pipeline (intent → drawing → material → plan → calc)
  intent.ts       intent/language routing
  drawing.ts      vision drawing analysis (tiling + dimension chain verification)
  machining.ts    Fachkunde-calibrated cutting data + ISO formula calculator
  clamping_check.ts  Kienzle cutting-force clamping check
  cost_compare.ts    handling-cost comparison
  products.ts / product_images.ts  product DB access + shop photo matcher
  rag.ts / llm.ts / schemas.ts / config.ts
src/            React frontend (Vite, deployed to Firebase)
tests/          unit tests (npm test), gauntlet, eval harness (tests/eval.py)
docs/           ROADMAP.md, SYSTEM.md
assets/         product photos (served at /product-images)
data/           hainbuch-website crawl dump (re-ingest source)
```

## Pipeline

1. **Intent** — classify request + language; PDF/DXF/image attachments parsed
   (PDF: server-rendered pages + embedded text; DXF: deterministic dimensions).
2. **Material** — retrieval from Fachkunde/Tabellenbuch → LLM picks material
   group + norm raw stock (strict JSON).
3. **Arbeitsplan + Spannmittel** — retrieval from the HAINBUCH catalogue →
   LLM plans operations with tool, ∅, Schnittweg, passes.
4. **Calculation (code, not LLM)** — `server/machining.ts` clamps cutting
   values to Fachkunde Richtwerte and computes n, vf, t per operation.
   ISO 286 fits, Kernloch, Spannkraft etc. are solved by the RAG API.

## Run

Prerequisites:
- LLM endpoint (VibeProxy on 8317 or LM Studio on 1234 — see `.env`)
- Knowledge base API: `/Users/lorenc/mlx-env/bin/python /Users/lorenc/Desktop/Engineering-RAG/scripts/rag_api.py`

```bash
bash start.sh          # starts everything (RAG API, advisor, tunnel)
# or manually:
npm install
cp .env.example .env
npm run dev            # http://localhost:3000
```

```bash
npm test               # 31 unit tests (machining, cost, clamping)
python3 tests/eval.py  # 15-question eval against the running advisor
npm run gauntlet       # 11 hard end-to-end cases
bash deploy.sh         # build + deploy frontend to hainbuchki.web.app
```

## Config (.env)

| Var | Default | |
|---|---|---|
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | OpenAI-compatible endpoint |
| `MODEL_ID` | `agents-a1-mlx-oq8` | model id |
| `RAG_API_URL` | `http://127.0.0.1:7777` | Engineering-RAG retrieval API |
| `MAX_RPM` | `8000` | spindle limit assumption |
| `APP_KEY` | — | shared key required for /api/chat (set by start.sh) |
