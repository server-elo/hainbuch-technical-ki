#!/bin/bash
# Start the complete HAINBUCH Technical Advisor stack with one command.
# Prerequisite: VibeProxy running on 8317 with Gemini 3.1 Pro (or set LMSTUDIO_URL/MODEL_ID in .env).
set -u

RAG_DIR="/Users/lorenc/Desktop/Engineering-RAG"
APP_DIR="/Users/lorenc/Desktop/hainbuch-technical-advisor"
PY="/Users/lorenc/mlx-env/bin/python"

echo "── HAINBUCH Technical Advisor ──────────────────────────"

# 1) LLM endpoint reachable (VibeProxy default, or LM Studio via .env)
LLM_URL="${LMSTUDIO_URL:-http://127.0.0.1:8317/v1}"
if curl -s --max-time 3 "${LLM_URL}/models" > /dev/null; then
  echo "✓ LLM-API erreichbar (${LLM_URL})"
else
  echo "✗ LLM-API nicht erreichbar (${LLM_URL}) — VibeProxy starten oder LM Studio öffnen."
  exit 1
fi

# 2) RAG API (skip if already running)
if curl -s --max-time 2 http://127.0.0.1:7777/health > /dev/null; then
  echo "✓ Wissensdatenbank läuft bereits (7777)"
else
  echo "… Wissensdatenbank wird gestartet (BGE-M3 lädt ~1 min)"
  # Hinweis: launchd-Autostart scheitert an macOS-Desktop-Schutz (TCC),
  # solange das Projekt unter ~/Desktop liegt — daher Start aus dem Terminal.
  (cd "$RAG_DIR/scripts" && RAG_RERANK=1 nohup "$PY" rag_api.py > "$RAG_DIR/logs/rag_api.log" 2>&1 &)
  until curl -s --max-time 2 http://127.0.0.1:7777/health 2>/dev/null | grep -q '"engine_loaded":true'; do
    sleep 2
  done
  echo "✓ Wissensdatenbank bereit (7777)"
fi

# 3) Advisor web app
if curl -s --max-time 2 -o /dev/null http://localhost:3000/; then
  echo "✓ Advisor läuft bereits (3000)"
else
  echo "… Advisor wird gestartet"
  APP_KEY=$(cat "$APP_DIR/.app_key" 2>/dev/null || true)
  (cd "$APP_DIR" && APP_KEY="$APP_KEY" nohup npm run dev > /tmp/hainbuch-advisor.log 2>&1 &)
  until curl -s --max-time 2 -o /dev/null http://localhost:3000/; do sleep 1; done
  echo "✓ Advisor bereit"
fi

echo ""
echo "→ Öffnen: http://localhost:3000"

# 4) Öffentlicher Zugang (optional): Tunnel für https://hainbuchki.web.app
if [ -f "$APP_DIR/.tunnel_url" ]; then
  if ! pgrep -f "cloudflared tunnel" > /dev/null; then
    echo "… Tunnel wird gestartet (Web-Zugang)"
    nohup cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
    sleep 5
    NEW_URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cloudflared.log | head -1)
    if [ -n "$NEW_URL" ] && [ "$NEW_URL" != "$(cat "$APP_DIR/.tunnel_url")" ]; then
      echo "⚠ Neue Tunnel-URL — einmal 'bash deploy.sh' ausführen, damit die Website sie kennt."
    fi
  fi
fi
