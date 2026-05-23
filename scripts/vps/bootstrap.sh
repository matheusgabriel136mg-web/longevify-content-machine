#!/bin/bash
# Bootstrap script — Ubuntu 24.04 VPS pra Longevify content-machine
# Roda como: ssh root@VPS_IP "bash -s" < scripts/vps/bootstrap.sh
#
# Tan principle: safety nets BEFORE code.

set -euo pipefail  # exit on error, unset var, pipe fail
IFS=$'\n\t'

REPO_URL="https://github.com/matheusgabriel136mg-web/longevify-content-machine.git"
INSTALL_DIR="/opt/content-machine"
NODE_VERSION="22"
USER_NAME="root"
LOG=/var/log/longevify-bootstrap.log

mkdir -p "$(dirname $LOG)"
exec > >(tee -a "$LOG") 2>&1

echo "════════════════════════════════════════════════════"
echo "Longevify content-machine bootstrap"
echo "Date: $(date)"
echo "Host: $(hostname)"
echo "════════════════════════════════════════════════════"

# ─── 1. System update ────────────────────────────────────────────────────────
echo ""
echo "[1/8] System update..."
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git ca-certificates gnupg \
  build-essential python3 \
  sqlite3 \
  ffmpeg imagemagick \
  rsync cron

# ─── 2. Node.js 22 ────────────────────────────────────────────────────────────
echo ""
echo "[2/8] Node.js $NODE_VERSION..."
if ! command -v node >/dev/null || ! node --version | grep -q "v${NODE_VERSION}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y -qq nodejs
fi
node --version
npm --version

# ─── 3. Higgsfield CLI (Linux binary) ────────────────────────────────────────
echo ""
echo "[3/8] Higgsfield CLI..."
if ! command -v higgsfield >/dev/null; then
  # Attempt official install — fallback to manual if needed
  curl -fsSL https://higgsfield.ai/install.sh | bash || {
    echo "⚠ Higgsfield install failed. Manual install needed."
    echo "  See: https://docs.higgsfield.ai/cli/install"
  }
fi
higgsfield --version 2>&1 || echo "  (higgsfield not yet authed — auth manualmente)"

# ─── 4. Clone repo ────────────────────────────────────────────────────────────
echo ""
echo "[4/8] Cloning repo..."
if [ -d "$INSTALL_DIR" ]; then
  echo "  Existing dir found — git pull"
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ─── 5. npm install ───────────────────────────────────────────────────────────
echo ""
echo "[5/8] npm install..."
npm install --omit=dev --silent

# ─── 6. .env setup (template — Matheus precisa popular) ──────────────────────
echo ""
echo "[6/8] .env template..."
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<'EOF'
# === PRECISA POPULAR ANTES DE RODAR ===
ANTHROPIC_API_KEY=
HIGGSFIELD_API_KEY=
APIFY_API_TOKEN=
META_PAGE_ACCESS_TOKEN=
IG_BUSINESS_ACCOUNT_ID=
META_PAGE_ID=
META_APP_ID=
META_APP_SECRET=
CLOUDINARY_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
  echo "  ✓ .env template criado em $INSTALL_DIR/.env"
  echo "  ⚠ Popula via: scp local-.env root@VPS:$INSTALL_DIR/.env"
fi
chmod 600 "$INSTALL_DIR/.env"

# ─── 7. Backup folder (safety net D) ──────────────────────────────────────────
echo ""
echo "[7/8] Backup folder..."
mkdir -p /opt/longevify-backups
chmod 700 /opt/longevify-backups

# ─── 8. Systemd timers (cron replacement) ────────────────────────────────────
echo ""
echo "[8/8] Systemd timers..."
SERVICES_DIR=/etc/systemd/system

# Daily Brief 7am BRT (= 10:00 UTC)
cat > $SERVICES_DIR/longevify-daily-brief.service <<EOF
[Unit]
Description=Longevify Daily Content Brief
After=network.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/daily-brief.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-daily-brief.log
StandardError=append:/var/log/longevify-daily-brief.log
EOF

cat > $SERVICES_DIR/longevify-daily-brief.timer <<EOF
[Unit]
Description=Run Daily Brief 7am BRT daily

[Timer]
OnCalendar=*-*-* 10:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# IG Insights scraper a cada 6h
cat > $SERVICES_DIR/longevify-insights.service <<EOF
[Unit]
Description=Longevify IG Insights Scraper

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/ig-insights-scraper.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-insights.log
StandardError=append:/var/log/longevify-insights.log
EOF

cat > $SERVICES_DIR/longevify-insights.timer <<EOF
[Unit]
Description=IG Insights every 6h

[Timer]
OnCalendar=*-*-* 0,6,12,18:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Foundation Auto-Updater (segunda 03:00 BRT = 06:00 UTC)
cat > $SERVICES_DIR/longevify-auto-updater.service <<EOF
[Unit]
Description=Longevify Foundation Auto-Updater weekly

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/foundation-auto-updater.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-auto-updater.log
StandardError=append:/var/log/longevify-auto-updater.log
EOF

cat > $SERVICES_DIR/longevify-auto-updater.timer <<EOF
[Unit]
Description=Foundation Auto-Updater weekly (Mon 03:00 BRT)

[Timer]
OnCalendar=Mon *-*-* 06:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Cross-version Diarization (dom 23:00 BRT = 02:00 UTC seg)
cat > $SERVICES_DIR/longevify-cross-version.service <<EOF
[Unit]
Description=Longevify Cross-Version Diarization weekly

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/cross-version-diarization.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-cross-version.log
StandardError=append:/var/log/longevify-cross-version.log
EOF

cat > $SERVICES_DIR/longevify-cross-version.timer <<EOF
[Unit]
Description=Cross-Version Diarization weekly (Sun 23:00 BRT)

[Timer]
OnCalendar=Mon *-*-* 02:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Idea picker (dom 22:00 BRT = 01:00 UTC seg)
cat > $SERVICES_DIR/longevify-idea-picker.service <<EOF
[Unit]
Description=Longevify Idea Picker weekly

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/idea-picker.mjs --days 7
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-idea-picker.log
StandardError=append:/var/log/longevify-idea-picker.log
EOF

cat > $SERVICES_DIR/longevify-idea-picker.timer <<EOF
[Unit]
Description=Idea Picker weekly (Sun 22:00 BRT)

[Timer]
OnCalendar=Mon *-*-* 01:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Pipeline tick (a cada 15min)
cat > $SERVICES_DIR/longevify-pipeline.service <<EOF
[Unit]
Description=Longevify Pipeline tick

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/pipeline.mjs tick
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-pipeline.log
StandardError=append:/var/log/longevify-pipeline.log
EOF

cat > $SERVICES_DIR/longevify-pipeline.timer <<EOF
[Unit]
Description=Pipeline tick every 15min

[Timer]
OnCalendar=*-*-* *:00,15,30,45:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Backup daily 03:00 UTC
cat > $SERVICES_DIR/longevify-backup.service <<EOF
[Unit]
Description=Longevify daily backup

[Service]
Type=oneshot
ExecStart=/bin/bash -c "rsync -av --delete /tmp/longevify-* /opt/longevify-backups/\$(date +%%Y-%%m-%%d)/ 2>&1 | tail -20"
StandardOutput=append:/var/log/longevify-backup.log
StandardError=append:/var/log/longevify-backup.log
EOF

cat > $SERVICES_DIR/longevify-backup.timer <<EOF
[Unit]
Description=Daily backup 03:00 UTC

[Timer]
OnCalendar=*-*-* 03:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Pre-publish alerts (every 5min)
cat > $SERVICES_DIR/longevify-prepublish.service <<EOF
[Unit]
Description=Longevify pre-publish T-15min alerts

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/prepublish-alerts.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-prepublish.log
StandardError=append:/var/log/longevify-prepublish.log
EOF

cat > $SERVICES_DIR/longevify-prepublish.timer <<EOF
[Unit]
Description=Pre-publish T-15min alerts every 5min

[Timer]
OnCalendar=*-*-* *:00,05,10,15,20,25,30,35,40,45,50,55:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Competitor tracker (weekly Sat 04:00 BRT = 07:00 UTC)
cat > $SERVICES_DIR/longevify-competitor.service <<EOF
[Unit]
Description=Longevify Competitor Tracker weekly

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/competitor-tracker.mjs
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=append:/var/log/longevify-competitor.log
StandardError=append:/var/log/longevify-competitor.log
EOF

cat > $SERVICES_DIR/longevify-competitor.timer <<EOF
[Unit]
Description=Competitor Tracker weekly (Sat 04:00 BRT)

[Timer]
OnCalendar=Sat *-*-* 07:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Telegram bot (long-poll daemon — service, not timer)
cat > $SERVICES_DIR/longevify-bot.service <<EOF
[Unit]
Description=Longevify Telegram Bot (long-poll)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node scripts/agents/telegram-bot.mjs
EnvironmentFile=$INSTALL_DIR/.env
Restart=always
RestartSec=10
StandardOutput=append:/var/log/longevify-bot.log
StandardError=append:/var/log/longevify-bot.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
for timer in daily-brief insights auto-updater cross-version idea-picker pipeline backup prepublish competitor; do
  systemctl enable longevify-${timer}.timer
  systemctl start longevify-${timer}.timer
done
systemctl enable longevify-bot.service
systemctl start longevify-bot.service
echo "  ✓ 9 systemd timers + 1 daemon (telegram-bot) configured + enabled + started"

echo ""
echo "════════════════════════════════════════════════════"
echo "✅ Bootstrap COMPLETE"
echo ""
echo "Próximos passos:"
echo "  1. Popula $INSTALL_DIR/.env (scp do .env local)"
echo "  2. Auth higgsfield: cd $INSTALL_DIR && higgsfield auth login"
echo "  3. Smoke tests:"
echo "     - node scripts/agents/telegram-notify.mjs --test"
echo "     - node scripts/pipeline.mjs status"
echo "     - systemctl list-timers --no-pager | grep longevify"
echo "  4. Logs em /var/log/longevify-*.log"
echo ""
echo "Cronograma cron:"
echo "  - 7am BRT: Daily Brief → Telegram"
echo "  - 6h,12h,18h,0h UTC: IG insights scrape"
echo "  - Sun 22:00 BRT: Idea Picker"
echo "  - Sun 23:00 BRT: Cross-version Diarization"
echo "  - Mon 03:00 BRT: Foundation Auto-Updater"
echo "  - every 15min: pipeline.mjs tick"
echo "  - daily 03:00 UTC: backup /tmp/longevify-* → /opt/longevify-backups/"
echo "════════════════════════════════════════════════════"
