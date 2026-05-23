# Operational Manual — Longevify content-machine

> Runbook pra debug/intervention em produção (VPS Hetzner CX23, IP 178.105.184.134).
> Atualizado 2026-05-23.

---

## 🏗 ARQUITETURA

```
┌──────────────────────────────────────────────────────────┐
│  VPS Hetzner (always-on, R$35/mês)                       │
│  /opt/content-machine — clone do github main             │
│                                                           │
│  Systemd timers (7):                                     │
│    pipeline.timer      — 15min — state machine tick     │
│    insights.timer      — 6h    — IG scrape              │
│    daily-brief.timer   — 10:00 UTC — push Telegram      │
│    idea-picker.timer   — Mon 01:00 UTC                  │
│    cross-version.timer — Mon 02:00 UTC                  │
│    auto-updater.timer  — Mon 06:00 UTC                  │
│    backup.timer        — daily 03:00 UTC                │
│    prepublish-alerts   — every 5min                     │
│    telegram-bot        — long-poll daemon (service)     │
│                                                           │
│  SQLite (single files):                                  │
│    runs/_pipeline.db   — state machine                  │
│    runs/_insights.db   — IG metrics history             │
│                                                           │
│  Audit logs:                                             │
│    runs/_audit-log.jsonl  (append-only JSONL)          │
│    /var/log/longevify-*.log  (systemd output)          │
└──────────────────────────────────────────────────────────┘
        │
        │ git push/pull
        ▼
┌──────────────────────────────────────────────────────────┐
│  github.com/matheusgabriel136mg-web/longevify-content... │
│  Single source of truth                                  │
└──────────────────────────────────────────────────────────┘
        ▲
        │
┌──────────────────────────────────────────────────────────┐
│  Mac local (dev + dashboard local)                       │
│  ~/longevify-content-dashboard.html + node server       │
│  Telegram bot (em telefone) → comandos remote           │
└──────────────────────────────────────────────────────────┘
```

---

## 🔑 ACESSOS

```bash
# SSH
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134

# Bitwarden entries:
- longevify-vps-hetzner   (IP, user, SSH key path)
- longevify-telegram      (bot token, chat_id, bot username)
- (Anthropic + Meta + Cloudinary keys já estão no .env)
```

---

## 🔄 FLUXO PADRÃO (sem intervenção)

```
00:00 cron - sleeping
01:00 (Mon) - idea-picker → popula slots da semana
02:00 (Mon) - cross-version diarization → flag drifts
03:00 daily - backup /tmp → /opt/longevify-backups
06:00 (Mon) - foundation auto-updater → propõe PR foundation
07:00 daily - daily-brief → Telegram push
*/15 always - pipeline tick → state machine transitions
*/5 always - prepublish-alerts → Telegram T-15min se houver slot
*/6h - insights scrape → atualiza _insights.db

Founder (você):
- 7am: lê Telegram brief
- 7-7:30am: aprova/rejeita escalations
- T-15min antes de slot: vê alert, responde /publish <id> + /confirm
```

---

## 🛠 COMANDOS COMUNS

### SSH no VPS
```bash
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134
cd /opt/content-machine
```

### Atualizar código no VPS
```bash
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134 "cd /opt/content-machine && git stash && git pull"
```
(stash necessário porque audit-log + sqlite dbs mudam em produção)

### Pipeline status
```bash
node scripts/pipeline.mjs status
node scripts/pipeline.mjs tick    # force run agora
node scripts/pipeline.mjs run --run <id>
node scripts/pipeline.mjs reset --run <id>  # reset failed
```

### Critic agent em draft específico
```bash
node scripts/agents/editor-agent.mjs --run <id>
```

### Content-generator (manual)
```bash
node scripts/agents/content-generator.mjs --run <id>
# Auto-dispatches por pattern: persona-bio | dado-punch | manifesto | biomarker-gap | reel-tips
```

### Daily brief manual
```bash
node scripts/agents/daily-brief.mjs
```

### IG insights manual
```bash
node scripts/agents/ig-insights-scraper.mjs              # scrape all
node scripts/agents/ig-insights-scraper.mjs --run <id>   # specific
node scripts/agents/ig-insights-scraper.mjs --ranking    # show ranking
```

### Cross-version diarization
```bash
node scripts/agents/cross-version-diarization.mjs
```

### Idea picker
```bash
node scripts/agents/idea-picker.mjs --days 7 [--dry-run]
```

### Foundation auto-updater
```bash
node scripts/agents/foundation-auto-updater.mjs
```

### Publish (CLI direto — bypass Telegram)
```bash
npm run publish -- --run <id>
```

---

## 🚨 TROUBLESHOOTING

### Circuit OPEN (cost ou quality breaker)
**Sintoma:** Telegram alert "Circuit OPEN: cost breaker $42.00 > $40/day"
**Fix:**
```bash
# 1. Confirma estado
cat runs/_circuit-state.json

# 2. Reset manual (após investigar)
echo '{"state":"CLOSED","cost_today":0,"reject_streak":0,"cost_today_date":"'$(date -u +%Y-%m-%d)'"}' > runs/_circuit-state.json

# 3. Investiga causa raiz no audit log
grep "cost" runs/_audit-log.jsonl | tail -20
```

### Higgsfield silent fail (job morre sem URL)
**Sintoma:** /tmp/longevify-X/job.log vazio ou sem URL
**Fix:**
```bash
# Use higgsfield-retry wrapper (já auto-retries 2x)
node scripts/agents/higgsfield-retry.mjs --prompt "..." --aspect-ratio 1:1 --out path.png
```

### Telegram não envia
**Sintoma:** Daily brief não chega
**Fix:**
```bash
# 1. Test direto
node scripts/agents/telegram-notify.mjs --test

# 2. Verifica env
grep TELEGRAM .env

# 3. Bot pode estar bloqueado — re-cria via @BotFather
```

### Pipeline travada (todos em "blocked")
**Sintoma:** status mostra muitos "blocked" sem motivo claro
**Fix:**
```bash
# Verifica reason
sqlite3 runs/_pipeline.db "SELECT run_id, state, failure_reason FROM runs WHERE state='blocked';"

# Reset all blocked (cuidado — pode reativar runs problemáticos)
sqlite3 runs/_pipeline.db "UPDATE runs SET state='draft', failure_reason=NULL WHERE state='blocked';"
```

### Editor agent retornando ERROR
**Sintoma:** decisões marcadas ERROR no audit log
**Fix:**
```bash
# Test manual + inspeciona output
node scripts/agents/editor-agent.mjs --run <id> 2>&1 | head -50

# Causa comum: draft-package.md sem caption section
ls runs/<id>/draft-package.md && grep "### Caption" runs/<id>/draft-package.md
```

### VPS sem espaço em disco
**Sintoma:** writes falham
**Fix:**
```bash
df -h
# Maior consumo geralmente: /tmp/longevify-reel-frames (10GB+ se muitos reels)
rm -rf /tmp/longevify-reel-frames /tmp/longevify-*-tpl-frames
```

### Disaster recovery (algo deletou runs/)
**Fix:** git restore + Higgsfield Cloudfront cache
```bash
git restore runs/
ls /tmp/longevify-*/  # check pra Cloudfront URLs cached
# Ver decisoes/2026-05-22-disaster-postmortem.md
```

---

## 📊 ONDE ESTÁ TUDO

### Source of truth
- `/Users/mathe/Documents/Longev/Claude Code/CEO/contexto/brand-truth.md` — canonical brand v2.0
- `foundation/strategy.md` — derivado, ICP operacional
- `foundation/pillars.md` — 6 pillars + persona matrix
- `foundation/voice.md` — 4 voice modes
- `foundation/persona-keywords.yaml` — strong/weak signals pra editor
- `foundation/safety-thresholds.yaml` — circuit breakers

### Compliance
- `foundation/compliance/avoid-slop.yaml` — regex/banned phrases
- `foundation/compliance/cfm-blocklist.yaml` — palavras médicas proibidas
- `foundation/master-avoid-slop.md` — versão humano-legível

### Templates
- `scripts/templates/_shared.mjs` — helpers comuns
- `scripts/templates/dado-punch.mjs` — single image stat
- `scripts/templates/brand-manifesto.mjs` — 5-slide manifesto
- `scripts/templates/biomarker-gap.mjs` — 5-slide biomarker
- `scripts/templates/reel-tips.mjs` — N-card reel

### Agents
- `scripts/agents/editor-agent.mjs` — 5-stage hybrid (LATENT vs DET)
- `scripts/agents/content-generator.mjs` — LLM gera persona/render-data + caption
- `scripts/agents/generator.mjs` — entry point routing
- `scripts/agents/critic-fix-loop.mjs` — auto-patch render code
- `scripts/agents/avoid-slop-scan.mjs` — deterministic scanner
- `scripts/agents/compliance-scan.mjs` — CFM deterministic
- `scripts/agents/safe-rm.mjs` — pre-flight checked delete
- `scripts/agents/queue.mjs` — queue manager
- `scripts/agents/planner.mjs` — slot planner (legacy)
- `scripts/agents/idea-picker.mjs` — gap-aware idea generation
- `scripts/agents/approver.mjs` — final ship/notify
- `scripts/agents/ig-insights-scraper.mjs` — IG Graph API metrics
- `scripts/agents/daily-brief.mjs` — Diarization #1 morning brief
- `scripts/agents/foundation-auto-updater.mjs` — Diarization #2 weekly
- `scripts/agents/cross-version-diarization.mjs` — Diarization #3 weekly
- `scripts/agents/telegram-notify.mjs` — outbound push
- `scripts/agents/telegram-bot.mjs` — long-poll incoming commands
- `scripts/agents/prepublish-alerts.mjs` — T-15min Telegram
- `scripts/agents/higgsfield-retry.mjs` — silent fail recovery
- `scripts/agents/prepare-labeling-batch.mjs` — ground truth labeling

### Orchestrator
- `scripts/pipeline.mjs` — state machine SQLite

### Data files
- `runs/_pipeline.db` — state SQLite
- `runs/_insights.db` — IG metrics SQLite
- `runs/_queue.json` — current queue
- `runs/_circuit-state.json` — circuit breaker state
- `runs/_audit-log.jsonl` — append-only audit log
- `runs/_telegram-bot-state.json` — last_update_id pra long-poll
- `runs/_publish-pending.json` — /publish aguardando /confirm
- `runs/_prepublish-alerts.json` — anti-spam state
- `runs/_briefs/morning-*.md` — daily briefs
- `runs/_briefs/cross-version-*.md` — diarization #3 outputs
- `runs/_briefs/foundation-auto-updater-*.md` — diarization #2 outputs
- `runs/_briefs/CRITICAL-DRIFT-FLAGS-*.md` — flags ativos
- `runs/_labeling/<date>/` — ground truth labeling batches
- `runs/_archived/<timestamp>__<name>/` — soft-deleted runs
- `runs/<id>/` — per-run dirs

### VPS log paths
```
/var/log/longevify-bootstrap.log
/var/log/longevify-pipeline.log
/var/log/longevify-daily-brief.log
/var/log/longevify-insights.log
/var/log/longevify-idea-picker.log
/var/log/longevify-cross-version.log
/var/log/longevify-auto-updater.log
/var/log/longevify-backup.log
```

---

## 📝 CHECKLIST D10 GO-LIVE

- [ ] Ground truth labeling (Matheus 50min)
- [ ] Editor calibração: % concordância ≥ 85% após labeling
- [ ] Shadow mode 2 dias completos sem intervenção
- [ ] Telegram bot rodando 24h sem crash
- [ ] Pelo menos 3 posts published com insights coletados
- [ ] Critical drift flags TODOS endereçados
- [ ] Circuit breakers nunca abriram em shadow mode

---

## 🔥 KILL SWITCHES (situação extrema)

### Pause tudo (para todos os timers)
```bash
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134 "systemctl stop 'longevify-*.timer'"
```

### Re-enable
```bash
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134 "systemctl start 'longevify-*.timer'"
```

### Stop Telegram bot daemon
```bash
ssh -i ~/.ssh/id_ed25519 root@178.105.184.134 "systemctl stop longevify-telegram-bot.service"
```

### Force circuit OPEN (parar processamento sem desligar timers)
```bash
echo '{"state":"OPEN","reason":"manual_pause"}' > runs/_circuit-state.json
git add runs/_circuit-state.json && git commit -m "manual pause" && git push
ssh ... "cd /opt/content-machine && git pull"
```

---

## 📦 BACKUP & RECOVERY

### Daily backup
- Auto via `longevify-backup.timer` → `/opt/longevify-backups/YYYY-MM-DD/`
- Mantém `/tmp/longevify-*` content
- TODO: lifecycle Glacier após 12 meses (R2 setup pendente)

### Local backup (Mac)
- `~/Documents/Longev/recovery-2026-05-22/` (manual, do D0 disaster)
- TODO: cron Mac local pull do VPS daily

### Git
- `github.com/matheusgabriel136mg-web/longevify-content-machine`
- Branch: `main`
- runs/ trackeada (decisão pós-disaster — see `decisoes/2026-05-22-disaster-postmortem.md`)
