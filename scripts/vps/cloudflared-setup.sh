#!/bin/bash
# scripts/vps/cloudflared-setup.sh — final cloudflared wiring (run AFTER manual auth + tunnel create).
#
# Prerequisites (founder runs once, browser required):
#   ssh root@VPS
#   cloudflared tunnel login                              # opens browser, auth
#   cloudflared tunnel create longevify-dashboard         # writes ~/.cloudflared/<UUID>.json
#
# Then run this script:
#   bash scripts/vps/cloudflared-setup.sh
#
# This script:
#   1. Reads the tunnel UUID from cloudflared tunnel list
#   2. Writes /etc/cloudflared/config.yml routing tunnel → http://127.0.0.1:4242
#   3. Installs cloudflared as systemd service
#   4. Prints the trycloudflare URL (or instructs DNS setup if you want a custom domain)

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/vps/cloudflared-setup.sh"
  exit 1
fi

if ! command -v cloudflared >/dev/null; then
  echo "✗ cloudflared not installed. Run bootstrap.sh first."
  exit 1
fi

# Find tunnel UUID for 'longevify-dashboard'
echo "→ Looking up tunnel 'longevify-dashboard'..."
TUNNEL_LINE=$(cloudflared tunnel list 2>/dev/null | grep -i "longevify-dashboard" || true)
if [ -z "$TUNNEL_LINE" ]; then
  echo "✗ Tunnel 'longevify-dashboard' not found."
  echo "  Run first: cloudflared tunnel login && cloudflared tunnel create longevify-dashboard"
  exit 1
fi
TUNNEL_UUID=$(echo "$TUNNEL_LINE" | awk '{print $1}')
echo "  ✓ Tunnel UUID: $TUNNEL_UUID"

# Locate the credentials JSON (cloudflared puts it in /root/.cloudflared by default)
CREDS_JSON="/root/.cloudflared/${TUNNEL_UUID}.json"
if [ ! -f "$CREDS_JSON" ]; then
  echo "✗ Credentials JSON not found at $CREDS_JSON"
  exit 1
fi

# Write the tunnel config
mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_UUID}
credentials-file: ${CREDS_JSON}

ingress:
  - hostname: "*"
    service: http://127.0.0.1:4242
  - service: http_status:404
EOF
echo "  ✓ /etc/cloudflared/config.yml written"

# Install as systemd service (cloudflared has built-in installer)
cloudflared --config /etc/cloudflared/config.yml service install 2>&1 || true
systemctl enable cloudflared
systemctl restart cloudflared
sleep 2
systemctl status cloudflared --no-pager | head -10
echo ""
echo "════════════════════════════════════════════════════"
echo "✅ Cloudflared tunnel running."
echo ""
echo "To get the public URL (trycloudflare.com hostname OR your custom hostname),"
echo "check: cloudflared tunnel info longevify-dashboard"
echo ""
echo "For a CUSTOM domain (e.g., ops.longevify.com.br):"
echo "  1. In Cloudflare DNS dashboard, add CNAME:"
echo "       ops  →  ${TUNNEL_UUID}.cfargotunnel.com"
echo "  2. Done — TLS is automatic via Cloudflare."
echo ""
echo "For a quick trycloudflare URL (zero DNS setup, expires when tunnel stops):"
echo "  cloudflared tunnel --url http://127.0.0.1:4242"
echo "  (run this instead of the systemd service for ephemeral testing)"
echo "════════════════════════════════════════════════════"
