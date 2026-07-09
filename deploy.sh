#!/bin/bash
# Deploy the HAINBUCH Technical Advisor to Firebase Hosting — one command.
# Checks/starts the Cloudflare tunnel, builds the frontend against the
# current tunnel URL + app key, deploys to https://hainbuchki.web.app
set -u
APP_DIR="/Users/lorenc/Desktop/hainbuch-technical-advisor"
cd "$APP_DIR"

echo "── Deploy: HAINBUCH Technical Advisor ─────────────────"

# 1) App-Key (einmal erzeugt, dann stabil)
if [ ! -f .app_key ]; then
  openssl rand -hex 16 > .app_key
  echo "✓ Neuer App-Key erzeugt"
fi
APP_KEY=$(cat .app_key)

# 2) Backend läuft?
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
  echo "… Backend wird gestartet"
  pkill -f "tsx server/server.ts" 2>/dev/null; sleep 2
  APP_KEY="$APP_KEY" nohup npm run dev > /tmp/hainbuch-advisor.log 2>&1 &
  until curl -s -o /dev/null --max-time 2 http://localhost:3000/; do sleep 2; done
fi
echo "✓ Backend läuft (localhost:3000)"

# 3) Tunnel läuft? Sonst starten und URL einsammeln
TUNNEL=""
if pgrep -f "cloudflared tunnel" > /dev/null && [ -f .tunnel_url ]; then
  TUNNEL=$(cat .tunnel_url)
  # noch erreichbar?
  if ! curl -s -o /dev/null --max-time 8 "$TUNNEL/health"; then
    TUNNEL=""
  fi
fi
if [ -z "$TUNNEL" ]; then
  echo "… Tunnel wird gestartet"
  pkill -f "cloudflared tunnel" 2>/dev/null; sleep 1
  nohup cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
  until grep -qo "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cloudflared.log 2>/dev/null; do sleep 2; done
  TUNNEL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cloudflared.log | head -1)
  echo "$TUNNEL" > .tunnel_url
fi
echo "✓ Tunnel: $TUNNEL"

# 4) Bauen mit Tunnel-URL + Key, deployen
echo "… Frontend wird gebaut"
VITE_API_BASE="$TUNNEL" VITE_APP_KEY="$APP_KEY" npx vite build > /dev/null
echo "… Deploy zu Firebase"
firebase deploy --only hosting 2>&1 | grep -E "Deploy complete|Hosting URL" || true

echo ""
echo "→ Online: https://hainbuchki.web.app"
