#!/bin/bash
# Self-healing supervisor for the HAINBUCH Technical Advisor stack.
# Run periodically (launchd): restarts dead services, replaces dead tunnels,
# and redeploys the frontend when the tunnel URL changes.
set -u

APP_DIR="/Users/lorenc/projects/hainbuch-technical-advisor"
RAG_DIR="/Users/lorenc/Desktop/Engineering-RAG"
PY="/Users/lorenc/mlx-env/bin/python"
LOG="/tmp/hainbuch-supervisor.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# ── 1) RAG API (7777) ────────────────────────────────────────────────
if ! curl -s --max-time 5 http://127.0.0.1:7777/health | grep -q '"status":"ok"'; then
  log "rag_api down — restarting"
  pkill -f "rag_api.py" 2>/dev/null; sleep 2
  (cd "$RAG_DIR/scripts" && RAG_RERANK=1 nohup "$PY" rag_api.py > "$RAG_DIR/logs/rag_api.log" 2>&1 &)
fi

# ── 2) Advisor (3000) ────────────────────────────────────────────────
if ! curl -s --max-time 5 -o /dev/null http://localhost:3000/; then
  log "advisor down — restarting"
  pkill -f "tsx server/server.ts" 2>/dev/null; sleep 2
  APP_KEY=$(cat "$APP_DIR/.app_key" 2>/dev/null || true)
  (cd "$APP_DIR" && APP_KEY="$APP_KEY" nohup npm run dev > /tmp/hainbuch-advisor.log 2>&1 &)
fi

# ── 3) Cloudflare tunnel (http2) ─────────────────────────────────────
TUNNEL=$(cat "$APP_DIR/.tunnel_url" 2>/dev/null || true)
FAIL_MARK="/tmp/hainbuch-tunnel-failing-since"
tunnel_ok=false
if pgrep -f "cloudflared tunnel" > /dev/null && [ -n "$TUNNEL" ]; then
  if curl -s --max-time 12 "$TUNNEL/api/status" 2>/dev/null | grep -q '"model"'; then
    tunnel_ok=true
    rm -f "$FAIL_MARK"
  else
    # process alive but URL failing — fresh quick-tunnel DNS takes minutes.
    # Only restart after 6 minutes of continuous failure.
    now=$(date +%s)
    if [ ! -f "$FAIL_MARK" ]; then
      echo "$now" > "$FAIL_MARK"
      tunnel_ok=true  # grace period
      log "tunnel URL not resolving yet — grace period started"
    else
      since=$(cat "$FAIL_MARK")
      if [ $((now - since)) -lt 360 ]; then
        tunnel_ok=true  # still within grace
      else
        log "tunnel failing for $((now - since))s — will restart"
      fi
    fi
  fi
fi
if [ "$tunnel_ok" = false ]; then
  log "tunnel down — restarting"
  pkill -f "cloudflared tunnel" 2>/dev/null; sleep 2
  rm -f "$FAIL_MARK"
  # detach fully: survive this script's launchd session teardown
  (nohup cloudflared tunnel --url http://localhost:3000 --protocol http2 > /tmp/cloudflared.log 2>&1 &) </dev/null
  for i in $(seq 1 15); do
    NEW=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cloudflared.log 2>/dev/null | head -1)
    [ -n "$NEW" ] && break
    sleep 2
  done
  if [ -n "${NEW:-}" ]; then
    echo "$NEW" > "$APP_DIR/.tunnel_url"
    log "new tunnel: $NEW"
    # wait for advisor + DNS, then rebuild frontend against the new URL
    for i in $(seq 1 30); do
      curl -s --max-time 2 -o /dev/null http://localhost:3000/ && break; sleep 2
    done
    sleep 20  # DNS propagation for fresh quick-tunnel hostnames
    APP_KEY=$(cat "$APP_DIR/.app_key" 2>/dev/null || true)
    if (cd "$APP_DIR" && VITE_API_BASE="$NEW" VITE_APP_KEY="$APP_KEY" npx vite build > /dev/null 2>&1 \
        && firebase deploy --only hosting > /dev/null 2>&1); then
      log "frontend redeployed against $NEW"
    else
      log "ERROR: frontend redeploy failed"
    fi
  else
    log "ERROR: tunnel failed to start"
  fi
fi
