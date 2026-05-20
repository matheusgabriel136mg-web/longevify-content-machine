#!/usr/bin/env bash
# health.sh — Print real state of every capability. Run FIRST in every session.
#
# Por quê: LLM confabula com base em summaries antigos. Antes de afirmar
# "X não funciona", rode isso e PROVA com bytes do disco.
#
# Uso: ./scripts/health.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; }
hdr()  { echo ""; echo "━━━ $* ━━━"; }

hdr "ENV vars (mascarado)"
for v in META_PAGE_ACCESS_TOKEN IG_BUSINESS_ACCOUNT_ID CLOUDINARY_URL APIFY_API_TOKEN ANTHROPIC_API_KEY GOOGLE_API_KEY HIGGSFIELD_API_KEY; do
  if grep -q "^${v}=" .env 2>/dev/null; then ok "$v set"; else fail "$v MISSING"; fi
done

hdr "Instagram Graph API"
if [ -f .env ]; then
  node --env-file=.env -e "
const id = process.env.IG_BUSINESS_ACCOUNT_ID;
const tok = process.env.META_PAGE_ACCESS_TOKEN;
if (!id || !tok) { console.log('❌ token/id missing'); process.exit(0); }
fetch(\`https://graph.facebook.com/v18.0/\${id}?fields=id,username,name&access_token=\${tok}\`)
  .then(r => r.json()).then(d => {
    if (d.error) console.log('❌ ' + d.error.message);
    else console.log('✅ Connected as @' + d.username + ' (id=' + d.id + ')');
  }).catch(e => console.log('❌ ' + e.message));
" 2>&1 | head -3
fi

hdr "Apify (scrape) — credit remaining"
if grep -q "^APIFY_API_TOKEN=" .env 2>/dev/null; then
  node --env-file=.env -e "
const tok = process.env.APIFY_API_TOKEN;
fetch('https://api.apify.com/v2/users/me?token=' + tok)
  .then(r => r.json()).then(d => {
    if (d.error) console.log('❌ ' + d.error.message);
    else console.log('✅ User: ' + d.data.username + ' | plan: ' + (d.data.plan?.id || '?'));
  }).catch(e => console.log('❌ ' + e.message));
" 2>&1 | head -2
fi

hdr "Snapshots em disco"
for kind in analysis tiktok-analysis; do
  count=$(ls -d "output/${kind}-"* 2>/dev/null | wc -l | xargs)
  latest=$(ls -d "output/${kind}-"* 2>/dev/null | sort | tail -1)
  if [ "$count" -gt 0 ]; then
    posts=$(jq '. | length' "$latest/raw-posts.json" 2>/dev/null || echo "?")
    ok "${kind}: $count snapshots, latest=$latest ($posts posts)"
  else
    warn "${kind}: 0 snapshots"
  fi
done

hdr "Dashboard (server + tunnel)"
if [ -f /tmp/longevify-server.pid ] && ps -p $(cat /tmp/longevify-server.pid) > /dev/null 2>&1; then
  ok "server alive (PID $(cat /tmp/longevify-server.pid))"
else
  fail "server DEAD"
fi
if [ -f /tmp/longevify-tunnel.pid ] && ps -p $(cat /tmp/longevify-tunnel.pid) > /dev/null 2>&1; then
  ok "tunnel alive (PID $(cat /tmp/longevify-tunnel.pid))"
  if [ -f /tmp/longevify-dashboard-url.txt ]; then
    url=$(cat /tmp/longevify-dashboard-url.txt)
    status=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    echo "         URL: $url  [HTTP $status]"
  fi
else
  fail "tunnel DEAD"
fi

hdr "Runs com drafts pendentes de publish"
for r in runs/2026-*/; do
  if [ -f "$r/draft-package.md" ]; then
    state=$(grep -E "^state:" "$r/content-object.md" 2>/dev/null | sed 's/state: //' || echo "?")
    assets=$(ls "$r/assets/"*.{png,jpg,mp4} 2>/dev/null | wc -l | xargs)
    name=$(basename "$r")
    if [ "$state" = "published" ]; then
      ok "$name (published)"
    elif [ "$assets" -gt 0 ]; then
      ok "$name — state=$state, $assets assets ready"
    else
      warn "$name — state=$state, 0 assets"
    fi
  fi
done

hdr "Cronograma — próximo slot"
today=$(date +%u) # 1=mon, 7=sun
case $today in
  1) echo "Hoje SEG: 11h Carrossel" ;;
  2) echo "Hoje TER: 19h Carrossel/DADO" ;;
  3) echo "Hoje QUA: 13h Reel" ;;
  4) echo "Hoje QUI: 19h Carrossel premium" ;;
  5) echo "Hoje SEX: 19h Single/FAIXA FUNCIONAL" ;;
  6) echo "Hoje SÁB: stories only" ;;
  7) echo "Hoje DOM: 10h Carrossel premium/OVERHEARD" ;;
esac
echo ""
echo "Done. Use isso pra calibrar antes de afirmar capacidades."
