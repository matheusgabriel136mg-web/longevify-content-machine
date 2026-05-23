# Skills Inventory — content-machine 14-day build

> **Princípio Tan (#3 Resolvers):** este arquivo é POINTER. Não carrega skills no contexto do pipeline.
> Skills são invocadas SOB DEMANDA via Skill tool, no momento que cada agent/step precisa.
> Editor-agent boot NÃO embeda 30 skills inteiras — embeda apenas pointers + invoca quando relevante.
>
> **Inventário:** 141 skills disponíveis (115 Brand CC + 26 user-level + plugin skills via Skill tool).
> Após filtragem por relevância ao build: **~35 skills mapeadas** abaixo. Resto = ignorar.

---

## 🟢 SKILLS NO BUILD DOS 14 DIAS

### D0 — Pre-build foundation (ANTES de codar editor-agent)

| Skill | Tipo | Localização | Por quê / Quando invocar |
|---|---|---|---|
| `agent-development` | Brand CC | `.claude/skills/agent-development` | LER ANTES de criar editor-agent. Estrutura, anti-patterns. |
| `auto-improvement` | Brand CC | `.claude/skills/auto-improvement` | LER. Editor melhora com feedback (ground truth labeling). |
| `circuit-breaker` | Brand CC | `.claude/skills/circuit-breaker` | LER. Implementar 3 safety nets (cost/quality/compliance). |
| `karpathy-guidelines` | user-level | `~/.claude/skills/karpathy-guidelines` | LER. Anti-bloat, disciplina código. |
| `voltagent-qa-sec:ai-writing-auditor` | plugin | via Skill tool | AUDITAR meu avoid-slop-scan.mjs. Já feito sem skill — verificar gaps. |

### D1-2 — Editor agent v1 + latent vs deterministic

| Skill | Por quê |
|---|---|
| `agent-development` | Pattern base do editor-agent |
| `senior-prompt-engineer` (Brand CC) | LLM prompts da camada latent (voice match, persona fit, hook "interesting?") |
| `llm-as-judge` (Brand CC) | Pattern de scoring LLM (rubric híbrida 0-12) |
| `circuit-breaker` | Cost/quality/compliance breakers no editor decision path |
| `copy-editing` (Brand CC) | Reference pra rubric de copy quality |
| `content-strategy` (Brand CC) | Informa rubric — está alinhado com pillar? persona? |

### D3 — Ground truth labeling

| Skill | Por quê |
|---|---|
| `customer-research` (Brand CC) | Pattern de coletar feedback estruturado do founder |
| `task-management` (Brand CC) | Track 50 pares labeled, status, divergências |

### D4-5 — pipeline.ts orchestrator + state machine

| Skill | Por quê |
|---|---|
| `executing-plans` (Brand CC) | Pattern de orchestrator state-machine |
| `autonomous-loop` (Brand CC) | Pattern do loop 24/7 |
| `dispatching-parallel-agents` (Brand CC) | Paralelizar generate (5+ drafts overnight) |
| `resilient-execution` (Brand CC) | Retry, timeout, recovery (Higgsfield silent fail!) |
| `senior-backend` (Brand CC) | Pipeline architecture |
| `database-schema-design` (Brand CC) | SQLite schema (queue, runs, audit log) |
| `file-organizer` (Brand CC) | Estrutura runs/ + foundation/ + stores/ |
| `superpowers:executing-plans` | Pattern alternativo, comparar |

### D6 — Daily Content Brief Diarization (#1)

| Skill | Por quê |
|---|---|
| `content-research-writer` (Brand CC) | Pattern de síntese de N inputs em 1 brief |
| `task-management` | Tracking de drafts/dia, status |

### D7 — IG insights scraper + auto-feedback

| Skill | Por quê |
|---|---|
| `analytics-tracking` (Brand CC) | Pattern de instrumentation + métricas |
| `senior-data-scientist` (Brand CC) | Cálculo de vsMedian, ranking patterns |
| `resilient-execution` | Retry quando IG API rate-limits |

### D8-9 — Foundation Auto-Updater Diarization (#2)

| Skill | Por quê |
|---|---|
| `auto-improvement` | LOOP de aprendizado (este é o coração) |
| `self-learning` (Brand CC) | Pattern de extrair regras de output histórico |
| `content-research-writer` | Sintetizar winners/losers em propostas de PR |

### D10 — Idea picker autônomo

| Skill | Por quê |
|---|---|
| `brainstorming` (Brand CC) | Geração de ideias por pilar/persona |
| `content-strategy` | Distribuição balanceada por pilar |
| `competitor-profiling` (Brand CC) | Refresh weekly do Mito/Function/Superpower |
| `competitor-alternatives` (Brand CC) | Mapear gaps de mercado pra ideação |
| `customer-research` | Síntese signals de source-watchlist |
| `marketing-psychology` (Brand CC) | Hook patterns por persona |

### D11 — Cross-version Diarization (#3)

| Skill | Por quê |
|---|---|
| `content-research-writer` | Sintetizar drift entre repos em 1 brief |

### D12-13 — Shadow mode test

| Skill | Por quê |
|---|---|
| `verification-before-completion` (Brand CC + superpowers:) | Não declarar go-live sem validação |
| `acceptance-testing` (Brand CC) | Pattern de acceptance criteria |

### D14 — Go-live

| Skill | Por quê |
|---|---|
| `finishing-a-development-branch` (Brand CC + superpowers:) | Discipline de "feature complete" + merge |
| `deployment` (Brand CC) | Cron + VPS deploy patterns |

### Suporte transversal (qualquer dia)

| Skill | Por quê |
|---|---|
| `claude-mem:make-plan` | Pra cada feature complexa (D4-5 pipeline, D6 brief generator) |
| `claude-mem:do` | Execução de plano sub-step |
| `claude-mem:knowledge-agent` | Construir "content-machine brain" pós-aprendizado (pós-D14) |
| `claude-api` | Anthropic SDK calls (todos os agents) |
| `mcp-builder` | Se editor-agent virar MCP server eventualmente |
| `skill-creator` | Quando identificar pattern recorrente neste build → vira skill |
| `systematic-debugging` (Brand CC + superpowers:) | Debug quando agent falhar em produção |
| `test-driven-development` (Brand CC + superpowers:) | Critic + editor PRECISAM ter testes |
| `claude-mem:mem-search` | Buscar "já resolvemos isso?" antes de re-implementar |

### Reels / video (se ativar)

| Skill | Por quê |
|---|---|
| `video` (Brand CC) | Pattern de video generation |
| `remotion-best-practices` (user-level) | Se migrar do ffmpeg manual pra Remotion |
| `video-use` (user-level) | Edit conversational de video |

### A/B testing + ads (futuro Cliff-style escala)

| Skill | Por quê |
|---|---|
| `ab-test-setup` (Brand CC) | Pattern de A/B em copy/visual |
| `ad-creative` (Brand CC) | Variações pra paid ads |
| `paid-ads` (Brand CC) | Quando ativar paid (não V1) |

### Email automation (V1.5 — pós-MVP autonomia)

| Skill | Por quê |
|---|---|
| `email-composer` (Brand CC) | Emails transacionais |
| `email-sequence` (Brand CC) | Nurture sequence pra waitlist |
| `lead-magnets` (Brand CC) | "Leitura grátis" lead magnet |
| `cold-email` (Brand CC) | Outbound (se ativar low-touch) |

---

## 🔴 SKILLS A IGNORAR (NÃO carregar — Tan principle: foco > volume)

**Tech irrelevante pro stack atual (TS + Node + SQLite + Sharp+SVG + ffmpeg):**
- `laravel-boost`, `laravel-specialist`, `php-specialist` — Longevify produto principal Python, não PHP
- `tailwind-design-system`, `tailwindcss`, `react-best-practices`, `shadcn` — dashboard fica pra V1.5+
- `ralph-status` — não usamos Ralph
- `docx-processing`, `xlsx-processing`, `pdf-processing` — content-machine produz IG, não documentos

**Plataformas que não vamos atacar V1:**
- `aso-audit` — não temos app store yet
- `ai-seo`, `programmatic-seo`, `schema-markup`, `seo-audit`, `seo-optimizer` — site não é foco V1
- `site-architecture`, `web-design-guidelines` — site é Brand CC, não content-machine
- `directory-submissions`, `popup-cro`, `signup-flow-cro`, `paywall-upgrade-cro` — CRO de site, fora escopo
- `community-marketing`, `referral-program`, `twitter-automation` — V1.5+
- `revops`, `sales-enablement`, `onboarding-cro`, `churn-prevention`, `pricing-strategy` — produto, não content
- `m-365`-style — não usamos

**Skills duplicadas com setup próprio:**
- `frontend-design`, `frontend-ui-design`, `mobile-design`, `ui-design-system`, `ui-ux-pro-max`, `make-interfaces-feel-better` — Sharp+SVG renderer próprio + visual decisions humanas (Matheus)
- `image-to-code`, `imagegen-frontend-web`, `imagegen-frontend-mobile`, `redesign-existing-projects` — não fazem sentido pra content-machine
- `ckm-*` (banner/brand/design/slides/ui-styling) — Brand CC tem brand-truth, content-machine não constrói brand kits
- `brandkit`, `clone-website`, `industrial-brutalist-ui`, `minimalist-ui`, `gpt-taste`, `design-taste-frontend`, `high-end-visual-design`, `stitch-design-taste`, `impeccable` — visual já travado em foundation/voice.md + Sharp renderer

**Skills experimentais sem maturidade no nosso stack:**
- `dev`, `playwright-cli`, `full-output-enforcement` — não necessárias agora
- `emil-design-eng`, `using-toolkit` — não claro fit

**Total skills ignorar:** ~60-70 das 141. Foco em ~35 skills mapeadas acima.

---

## 📐 COMO O EDITOR-AGENT VAI INVOCAR SKILLS (Tan #3 + #4)

```
editor_agent.boot()
  ↳ NÃO carrega skill files. Carrega só pointer (este inventory.md).

editor_agent.scan_avoid_slop(draft)
  ↳ deterministic primeiro (avoid-slop.yaml + scripts/agents/avoid-slop-scan.mjs)
  ↳ se passa, invoca `ai-writing-auditor` skill SOB DEMANDA pra catch nuance
  ↳ se ai-writing-auditor flagar, marca como advisory (não reject — det. já passou)

editor_agent.scan_compliance(draft)
  ↳ deterministic primeiro (cfm-blocklist.yaml + scripts/agents/compliance-scan.mjs)
  ↳ ambiguous_patterns invocam LLM com contexto pequeno (não skill inteira)

editor_agent.scan_persona_fit(draft)
  ↳ keywords shortlist deterministic primeiro
  ↳ depois LLM call PEQUENA com voice.md mode descriptor + draft

editor_agent.scan_hook_strength(draft)
  ↳ chars count + presença de paradoxo/número/pergunta deterministic
  ↳ depois LLM "this hook segura 2s?" — invocando `senior-prompt-engineer` skill
    APENAS se hook ambíguo
```

**Resultado:** editor-agent boot context ~2KB (pointer only). Decision call ~5-20KB (loaded sob demanda). Não vira 200KB de skills carregadas.

---

## 🔁 SKILLS PRA INVOCAR NO PRÓXIMO PASSO (D0 continuação)

1. **`agent-development`** — LER antes de retomar D0 (compliance-scan.mjs + telegram-notify.mjs)
2. **`circuit-breaker`** — LER antes do D1 (vai implementar 3 safety nets)
3. **`voltagent-qa-sec:ai-writing-auditor`** — INVOCAR contra meu avoid-slop-scan.mjs pra ver o que faltou

Após ler estes 3, continuo D0 com baseline alinhada.

---

## Changelog
- **2026-05-22 (D0):** Inicial. Mapping de 141 skills disponíveis → 35 relevantes ao build de 14 dias.
