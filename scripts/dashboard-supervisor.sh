#!/usr/bin/env bash
# dashboard-supervisor.sh — Mantém server.ts + localtunnel vivos com URL FIXA.
#
# Mudança 19/mai/2026: substituído cloudflared (URL volátil) por localtunnel
# com subdomain custom → URL FIXA pra sempre: https://longevify-dashboard.loca.lt
#
# Valle bookmarka uma vez, nunca mais quebra. Catch: loca.lt mostra página
# de aviso na primeira visita por device (clica "Click to Continue").
#
# Uso: nohup ./scripts/dashboard-supervisor.sh > /tmp/longevify-supervisor.log 2>&1 &
# Stop: pkill -f dashboard-supervisor; pkill -f "tsx scripts/server"; pkill -f localtunnel

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8088}"
SUBDOMAIN="${LT_SUBDOMAIN:-longevify-dashboard}"
URL_FILE="/tmp/longevify-dashboard-url.txt"
SERVER_LOG="/tmp/longevify-server.log"
TUNNEL_LOG="/tmp/longevify-tunnel.log"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── 1. Kill zombies ──────────────────────────────────────────────────────────
log "🧹 Limpando processos antigos..."
pkill -f "tsx scripts/server" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
pkill -f "localtunnel" 2>/dev/null
pkill -f "node.*lt --port" 2>/dev/null
sleep 2

# ── 2. Start server ──────────────────────────────────────────────────────────
log "🚀 Subindo server.ts na porta $PORT..."
cd "$ROOT"
nohup npx tsx scripts/server.ts > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > /tmp/longevify-server.pid
log "   server PID=$SERVER_PID"

# Wait for server to bind
for i in {1..15}; do
  if curl -s -o /dev/null -m 2 "http://localhost:$PORT/api/feed" -u "longevify:changeme"; then
    log "   ✓ server respondendo em http://localhost:$PORT"
    break
  fi
  sleep 1
done

# ── 3. Start localtunnel ─────────────────────────────────────────────────────
start_tunnel() {
  log "🌐 Subindo localtunnel (subdomain=$SUBDOMAIN)..."
  nohup npx --yes localtunnel --port "$PORT" --subdomain "$SUBDOMAIN" > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  echo "$TUNNEL_PID" > /tmp/longevify-tunnel.pid

  URL=""
  for i in {1..30}; do
    URL=$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$TUNNEL_LOG" | head -1)
    [ -n "$URL" ] && break
    sleep 1
  done

  if [ -z "$URL" ]; then
    log "   ❌ Tunnel não conseguiu URL em 30s. Tail:"
    tail -10 "$TUNNEL_LOG"
    return 1
  fi

  echo "$URL" > "$URL_FILE"
  log "   ✓ Tunnel: $URL (PID=$TUNNEL_PID)"
  log "   ✓ URL FIXA. Valle pode bookmarkar — não muda se cair."
}

start_tunnel

# ── 4. Watchdog ──────────────────────────────────────────────────────────────
log "👁  Watchdog ativo (ping a cada 60s)"

FAILS=0
while true; do
  sleep 60

  # Check server alive
  if ! curl -s -o /dev/null -m 5 "http://localhost:$PORT/api/feed" -u "longevify:changeme"; then
    log "⚠️  Server caiu — restartando"
    nohup npx tsx scripts/server.ts > "$SERVER_LOG" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > /tmp/longevify-server.pid
    sleep 5
  fi

  # Check tunnel alive
  if [ ! -f "$URL_FILE" ]; then
    log "⚠️  URL file sumiu — restartando tunnel"
    pkill -f "localtunnel" 2>/dev/null
    pkill -f "node.*lt --port" 2>/dev/null
    sleep 2
    start_tunnel
    FAILS=0
    continue
  fi

  CURRENT_URL=$(cat "$URL_FILE")
  STATUS=$(curl -s -o /dev/null -m 8 -w "%{http_code}" "$CURRENT_URL" 2>/dev/null || echo "000")

  # 200, 401, 511 (loca.lt aviso first-visit) são todos "alive"
  if [[ "$STATUS" =~ ^(200|301|302|401|403|511)$ ]]; then
    FAILS=0
  else
    FAILS=$((FAILS + 1))
    log "⚠️  Tunnel respondendo $STATUS ($FAILS/3 fails)"
    if [ "$FAILS" -ge 3 ]; then
      log "🔁 3 fails consecutivos — restartando tunnel (mesma URL)"
      pkill -f "localtunnel" 2>/dev/null
      pkill -f "node.*lt --port" 2>/dev/null
      sleep 2
      start_tunnel
      FAILS=0
    fi
  fi
done
