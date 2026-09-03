# Training loop — making the advisor better and better

Every chat turn (user question + assistant answer + thumbs feedback) is stored:
- **SQLite** `data/app.db` → tables `users`, `conversations`, `messages`, `feedback_db`, `sessions`
  (per-user history, e-mails, country + language per conversation)
- **JSONL mirror** `logs/chats.jsonl` + `logs/daily/*.jsonl` (unchanged, anonymous)

## Weekly routine (15 min)

1. **Export** the training feed (needs the backend running):
   ```bash
   node scripts/export_training.cjs            # all time
   node scripts/export_training.cjs 2026-09-01 # since date
   ```
   → `data/training/export-<date>.jsonl` with `{type:"message"|"feedback"|"chat", …}` lines
   (sanitized: salted id-hashes, dead hosts → `__BACKEND__`, base64 stripped).
   Cost lens: `node scripts/cost.cjs` shows calls/tokens/latency per model.
2. **Review**: open the file, search thumbs-down (`"rating":"down"`) first —
   those are your highest-value fixes. Note the pattern:
   wrong product photo? invented mat number? wrong fit class? missing source?
3. **Fix the code or the prompt** in `lite-server.cjs` (`SYSTEM_PROMPT`, QA checklist,
   `CANONICAL_HERO`, `retrieveShop`) — one fix per pattern, not per message.
4. **Promote the best answers** into `data/gold_standards.json`:
   ```json
   [{ "question": "<short user question>", "answer": "<ideal answer, ≤1500 chars used>" }]
   ```
   The server injects the closest gold standard into the system prompt
   (`retrieveGoldStandards`) — this is the fastest way to teach the model
   your preferred structure, image URLs and work-plan style.
5. **Redeploy**: `npx vite build && firebase deploy --only hosting`
   (backend changes: restart `node lite-server.cjs` with the same env).

## What the stored fields give you

| Field | Use |
|---|---|
| `users.email / country_code / ui_lang` | per-market quality: which country/language gets bad answers |
| `messages.content` (user + assistant) | fine-tune dataset / gold-standard candidates |
| `feedback_db.rating + message` | thumbs-down triage, thumbs-up promotion |
| `messages.duration_ms / model` | latency + model A/B comparison |
| `conversations.machine_profile` | machine-specific answer quality |

## Privacy

- Export endpoint `/api/admin/export` requires `ADMIN_KEY` (never exposed to the frontend).
- Data stays on your Mac (`data/app.db`) + EU Firebase project.
- User deletion: `DELETE /api/history/:id` soft-deletes; full account wipe =
  delete the `users` row + its conversations (add script on request).
- Only `consent_marketing = 1` rows may receive newsletters — the checkbox is
  off by default, so only users who explicitly opted in qualify. The server
  rejects new registrations without `consentTerms` (HTTP 400 terms-required).
