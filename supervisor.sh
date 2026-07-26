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

# Only one supervisor run at a time. Without this, a run that blocks on I/O
# (an unresponsive ~/Desktop) is joined every 2 min by another run that kills
# the tunnel it never gets far enough to replace — the site stays down while
# the log fills with "restarting".
exec 9>"/tmp/hainbuch-supervisor.lock"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
else
  # macOS has no flock(1): use an atomic mkdir lock with a stale-lock timeout.
  LOCKDIR=/tmp/hainbuch-supervisor.lockdir
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    age=$(( $(date +%s) - $(stat -f %m "$LOCKDIR" 2>/dev/null || date +%s) ))
    if [ "$age" -lt 900 ]; then exit 0; fi
    log "stale lock (${age}s) — taking over"
    rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null || exit 0
  fi
  trap 'rm -rf "$LOCKDIR"' EXIT
fi

# Is a path readable within N seconds? ~/Desktop can block forever when iCloud /
# File Provider is wedged, and every command touching it inherits that hang.
path_alive() {
  ( ls "$1" >/dev/null 2>&1 ) & local pid=$!
  ( sleep "${2:-5}"; kill -9 $pid 2>/dev/null ) >/dev/null 2>&1 & local killer=$!
  if wait $pid 2>/dev/null; then kill $killer 2>/dev/null; return 0; fi
  kill $killer 2>/dev/null; return 1
}

# ── 1) RAG API (7777) ────────────────────────────────────────────────
if ! curl -s --max-time 5 http://127.0.0.1:7777/health | grep -q '"status":"ok"'; then
  if ! path_alive "$RAG_DIR/scripts" 5; then
    # Restarting into a hung filesystem stalls this whole script, which is what
    # left the tunnel dead and hainbuchki.web.app unreachable.
    log "rag_api down but $RAG_DIR unreadable (Desktop/iCloud stalled) — skipping RAG, keeping site up"
  else
    log "rag_api down — restarting"
    pkill -f "rag_api.py" 2>/dev/null; sleep 2
    (cd "$RAG_DIR/scripts" && RAG_RERANK=1 nohup "$PY" rag_api.py > "$RAG_DIR/logs/rag_api.log" 2>&1 &)
  fi
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
    # Deploying a URL that is not serving yet points the live site at a dead
    # backend. Confirm the tunnel actually answers before rebuilding.
    tunnel_live=false
    for i in $(seq 1 20); do
      if curl -s --max-time 10 "$NEW/api/status" 2>/dev/null | grep -q '"model"'; then
        tunnel_live=true; break
      fi
      sleep 5
    done
    if [ "$tunnel_live" = false ]; then
      log "ERROR: new tunnel $NEW never answered — NOT redeploying (keeping current site)"
    else
      APP_KEY=$(cat "$APP_DIR/.app_key" 2>/dev/null || true)
      if (cd "$APP_DIR" && VITE_API_BASE="$NEW" VITE_APP_KEY="$APP_KEY" npx vite build > /dev/null 2>&1 \
          && firebase deploy --only hosting > /dev/null 2>&1); then
        log "frontend redeployed against $NEW"
      else
        log "ERROR: frontend redeploy failed"
      fi
    fi
  else
    log "ERROR: tunnel failed to start"
  fi
fi
