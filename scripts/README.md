# Content machine scripts — Phase 2

## new-run (scaffold)

Cria uma nova pasta de run a partir de `runs/_template/`.

```bash
pnpm new-run --slug cortisol-atleta-br

# Com pre-fill de frontmatter:
pnpm new-run --slug cortisol-atleta-br --pillar 2 --route rewrite --format reel --platform instagram
```

Cria `runs/YYYY-MM-DD-NNN-slug/` com `content-object.md` parcialmente pré-preenchido + os outros 4 templates intactos pra você preencher.

## writer (Phase 2 — Claude API)

Lê `runs/<id>/{content-object,idea,brief}.md`, carrega `foundation/*` + `idea-gate.md` como system prompt cacheado, chama Claude (Opus 4.7 por default), e produz `runs/<id>/draft-package.md`.

```bash
# Default (Opus, com prompt caching)
pnpm writer --run 2026-05-12-001-cortisol-atleta-br

# Sonnet (mais barato pra teste)
pnpm writer --run <id> --model sonnet

# Sem prompt caching (debug)
pnpm writer --run <id> --no-cache

# Verbose (mostra tamanhos de prompt)
pnpm writer --run <id> -v
```

### O que o writer faz

1. Lê `runs/<id>/content-object.md`, `idea.md`, `brief.md`
2. Carrega toda a Foundation no system prompt (com `cache_control: ephemeral` — economiza ~90% nos tokens em runs subsequentes)
3. Chama Claude com regras estritas: foundation-first, refuse-on-slop, self-rubric 0-12
4. Salva `draft-package.md` com frontmatter (status: pending_verify ou revise) + copy + visual brief + self-score
5. Backup automático de drafts antigos em `runs/<id>/drafts/draft-<timestamp>.md`
6. Atualiza `content-object.md` (state → draft, next_action → verify)

### Pré-requisitos

- `.env` com `ANTHROPIC_API_KEY=sk-ant-...`
- `runs/<id>/brief.md` preenchido (frontmatter + voice constraints + format spec + hook candidates + structure + visual brief)

### Fluxo típico

```
1. pnpm new-run --slug X --pillar N --route R --format F
2. Edita runs/<id>/idea.md à mão
3. Edita runs/<id>/brief.md à mão (Phase 2 — depois automatizado em Phase 3)
4. pnpm writer --run <id>
5. Abre runs/<id>/draft-package.md, revisa
6. Se score self-rubric < 9: ajusta brief, rode writer de novo (cria backup automaticamente)
7. Se ok: passa pro Verifier (Phase 4) ou aprova manualmente
```
