# Longevify content-machine

> Pipeline autônomo de geração de conteúdo Longevify (Instagram orgânico).
> VPS always-on + 10 systemd timers + Telegram mobile control + dashboard local.

## 🏗 Arquitetura (1 diagrama)

```
┌────────────────────────────────────────────────────────────────────────┐
│ VPS Hetzner CX23 (178.105.184.134) — always-on, R$35/mês             │
│                                                                         │
│ ┌─ Systemd timers (10) + 1 daemon ──────────────────────────────────┐ │
│ │  pipeline.timer       every 15min  — state machine tick           │ │
│ │  prepublish.timer     every 5min   — T-15min Telegram alert       │ │
│ │  insights.timer       every 6h     — IG Graph API scrape          │ │
│ │  daily-brief.timer    daily 10 UTC — Telegram morning brief       │ │
│ │  backup.timer         daily 03 UTC — /tmp → /opt + R2             │ │
│ │  idea-picker.timer    Mon 01 UTC   — gap-aware ideation           │ │
│ │  cross-version.timer  Mon 02 UTC   — Diarization #3 (4 repos)    │ │
│ │  auto-updater.timer   Mon 06 UTC   — Diarization #2 (foundation) │ │
│ │  competitor.timer     Sat 07 UTC   — competitor intel weekly      │ │
│ │  brand-drift.timer    1st month 04 — Diarization #4 (voice drift) │ │
│ │  bot.service          long-poll    — Telegram bot daemon          │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ Agentes ──────────────────────────────────────────────────────────┐ │
│ │  pipeline.mjs              orchestrator + SQLite state machine    │ │
│ │  editor-agent.mjs          5-stage hybrid (DET → LLM)             │ │
│ │  content-generator.mjs     LLM gera persona/render-data + caption │ │
│ │  generator.mjs             route brief → render template          │ │
│ │  critic-fix-loop.mjs       auto-patch render code on REVISE       │ │
│ │  idea-picker.mjs           gap-aware slot filler                  │ │
│ │  daily-brief.mjs           Diarization #1                         │ │
│ │  cross-version-diarization Diarization #3                         │ │
│ │  foundation-auto-updater   Diarization #2                         │ │
│ │  brand-drift-diarization   Diarization #4                         │ │
│ │  competitor-tracker.mjs    nacionais + diff + alert               │ │
│ │  ig-insights-scraper.mjs   IG Graph API metrics                   │ │
│ │  telegram-bot.mjs          long-poll commands + buttons           │ │
│ │  telegram-notify.mjs       outbound push                          │ │
│ │  prepublish-alerts.mjs     T-15min alert + preview                │ │
│ │  approver.mjs              final ship/notify                      │ │
│ │  safe-rm.mjs               pre-flight checked delete              │ │
│ │  avoid-slop-scan.mjs       deterministic YAML scanner             │ │
│ │  compliance-scan.mjs       CFM/Procon deterministic               │ │
│ │  higgsfield-retry.mjs      silent fail recovery                   │ │
│ │  r2-backup.mjs             anti-disaster persistent               │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ Templates renderer (Sharp+SVG) ───────────────────────────────────┐ │
│ │  render-persona-carousel.mjs  persona-bio 6 slides                │ │
│ │  scripts/templates/dado-punch.mjs       single image stat         │ │
│ │  scripts/templates/brand-manifesto.mjs  5-slide manifesto         │ │
│ │  scripts/templates/biomarker-gap.mjs    5-slide biomarker         │ │
│ │  scripts/templates/reel-tips.mjs        N-card reel mp4           │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ Storage ──────────────────────────────────────────────────────────┐ │
│ │  runs/_pipeline.db    SQLite state machine                        │ │
│ │  runs/_insights.db    SQLite IG metrics                           │ │
│ │  runs/_audit-log.jsonl                                            │ │
│ │  runs/_queue.json                                                  │ │
│ │  runs/<id>/                                                         │ │
│ │    ├─ idea.md                                                      │ │
│ │    ├─ content-object.md  (frontmatter + state)                    │ │
│ │    ├─ draft-package.md   (caption)                                │ │
│ │    ├─ render-data.json   (per-format structured data)             │ │
│ │    ├─ insights.json      (IG metrics snapshots)                   │ │
│ │    └─ assets/            (slide-N.png, .mp4)                       │ │
│ │  runs/_briefs/*.md       (diarizations output)                    │ │
│ │  runs/_archived/         (safe-rm soft delete)                    │ │
│ │  runs/_labeling/<date>/  (ground truth labeling batches)         │ │
│ │  R2 (anti-disaster):     daily tarball + 60d → IA tier           │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ git push/pull
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ github.com/matheusgabriel136mg-web/longevify-content-machine          │
│ Source of truth · branch main · runs/ tracked desde D0 disaster        │
└────────────────────────────────────────────────────────────────────────┘
       ▲                                                       ▲
       │                                                       │
┌──────────────────────────┐               ┌─────────────────────────────┐
│ Telegram bot daemon       │               │ Mac local (Matheus)         │
│  /status /brief /publish  │               │  ~/longevify-content-       │
│  /confirm /cancel /run    │               │   dashboard.html            │
│  /insights /queue /help   │               │  + scripts/dashboard-       │
│  inline buttons           │               │   server.mjs (port 4242)    │
│  T-15min alerts + preview │               └─────────────────────────────┘
└──────────────────────────┘
```

## 🎯 ICP (multi-persona horizontal)

**Hero ICP:** Profissional 30-50, classe A/B (renda R$10k+/mês), paga ≥R$500/mês saúde fora do plano.

**4 personas de copy:**
| Persona | Voice mode | Hook |
|---|---|---|
| Maria | Frustração validada (Aesop empático) | Fragmentação cara |
| Julia | Persona-bio warm (Equinox lifestyle) | Da sensação ao dado |
| Pedro | Athletic premium (Mito × Equinox) | Integração + AI on-demand |
| Ana | Biomarcador deep-dive (sofisticado) | Premium + cutting-edge |

Source of truth canonical: `/Users/mathe/Documents/Longev/Claude Code/CEO/contexto/brand-truth.md`

## 📅 Cronograma 4×/sem

| Dia | Slot | Format | Persona típica |
|---|---|---|---|
| Dom | 10h BRT | Carrossel premium | Todas / persona-bio |
| Seg | OFF | — | — |
| Ter | 19h BRT | Dado punch (single image) | Maria/Ana |
| Qua | OFF | — | — |
| Qui | 19h BRT | Carrossel deep-dive | Ana/Pedro |
| Sex | 19h BRT | **Persona-bio carrossel (fixo)** | rotaciona Julia/Pedro/Maria/Ana |
| Sáb | — | Stories only | — |

## 🤖 Loop autônomo end-to-end

```
Sun 22h ─ idea-picker autônomo (gap-aware) → runs/<id>/idea.md
              ↓
Cron tick ─ pipeline.mjs detecta state=draft → content-generator
              ↓
              LLM gera persona JSON / render-data + caption ($0.02-0.06)
              ↓
Cron tick ─ pipeline.mjs render via generator.mjs → template
              ↓
              Sharp+SVG renderiza 5-6 slides 1440×1800
              ↓
Cron tick ─ editor-agent (5-stage hybrid det→LLM)
              ↓
              APPROVE 8+/12 → state=approving
              OR REVISE → critic-fix-loop auto-patch (max 2 retries)
              OR REJECT/ESCALATE → telegram alert
              ↓
T-15min ───── prepublish-alert via Telegram (slides preview + buttons)
              ↓
Matheus ───── clica ✅ Approve OR responde "posta <id>"
              ↓
              publish.ts → Cloudinary + Meta Graph API
              ↓
              state=published + media_id salvo
              ↓
+24-72h ─── ig-insights-scraper coleta reach/saves/shares
              ↓
+30 dias ── foundation-auto-updater propõe PR baseado em winners/losers
```

## 💻 Quick start (dev local)

```bash
# Setup
git clone https://github.com/matheusgabriel136mg-web/longevify-content-machine.git
cd longevify-content-machine
npm install
cp .env.example .env  # popular keys

# Smoke
node scripts/pipeline.mjs status
node scripts/agents/telegram-notify.mjs --test

# Dashboard local
node scripts/dashboard-server.mjs
# Open http://localhost:4242
```

## 🚀 Deploy VPS

```bash
# First time
ssh root@VPS_IP "bash -s" < scripts/vps/bootstrap.sh
scp .env root@VPS_IP:/opt/content-machine/.env

# Updates
ssh root@VPS_IP "cd /opt/content-machine && git stash && git pull"
```

## 📚 Documentation

- `decisoes/operational-manual.md` — debug runbook, kill switches, troubleshooting
- `decisoes/2026-05-22-disaster-postmortem.md` — anti-disaster lessons
- `decisoes/2026-05-22-harness-audit-tan2.md` — Tan principle #2 harness design
- `foundation/skills-inventory.md` — 141 skills mapped → 35 usadas
- `scripts/vps/SETUP.md` — Hetzner + Telegram setup guide
- `scripts/vps/PREFLIGHT-CHECKLIST.md` — pre-deploy checklist

## 🔐 Safety nets (5)

1. `runs/` tracked em git (post-disaster)
2. `set -euo pipefail` em scripts shell destrutivos
3. `safe-rm.mjs` wrapper com pre-flight checks
4. Backup daily `/tmp/longevify-*` → `/opt/longevify-backups/` + R2
5. Cross-version Diarization #3 weekly detecta drift

## 💸 Custo operacional

| Item | Mensal estimado |
|---|---|
| Hetzner CX23 VPS | R$35 |
| Anthropic API (~16-30 posts) | R$80-150 |
| Higgsfield (Plus plan) | R$200 |
| Cloudflare R2 backup | R$0-25 |
| Cloudinary | R$0 (free tier) |
| **Total** | **~R$315-410/mês** |

## 🏁 Status atual (D10 ready)

- ✅ VPS provisionado + 10 timers + 1 daemon ativos
- ✅ Editor agent v1.1 calibrado (persona strong/weak)
- ✅ Content-generator full coverage (5 formats)
- ✅ Telegram mobile control (commands + inline buttons + previews)
- ✅ 4 diarizations (#1 daily, #2 weekly foundation, #3 weekly cross-version, #4 monthly brand-drift)
- ✅ Competitor intel (8 healthtech BR weekly)
- ⏳ Ground truth labeling (Matheus 50min) → editor calibration
- ⏳ 2-3 dias shadow mode → go-live decision

## 📞 Contatos sistema

- Telegram bot: @longevify_brief_bot
- VPS: 178.105.184.134 (Hetzner Nuremberg)
- Github: matheusgabriel136mg-web/longevify-content-machine
- Anthropic API: suporte@longevify.com.br

---

*Auto-gerado pelo content-machine D2 noite. Atualizado quando arquitetura muda.*
