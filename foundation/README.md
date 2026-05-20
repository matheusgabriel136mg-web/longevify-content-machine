# Foundation — Shared brain of the Longevify content machine

> This is the source of truth. Every writer, every verifier, every orchestrator pass reads from here. Stores feed back into here. The system gets sharper every loop.

## Layout

```
foundation/
├── strategy.md             — positioning, ICP, source watchlist
├── voice.md                — tone profile + master avoid-slop reference
├── pillars.md              — content pillars (Pilar 1-4)
├── master-avoid-slop.md    — ⭐ banned patterns/phrases/visuals
├── source-watchlist.md     — accounts/sites monitored externally
├── stores/                 — accumulated knowledge from runs
│   ├── inbox.md            — raw incoming ideas (pre-filter)
│   ├── ideas.md            — filtered idea pool
│   ├── hooks.md            — tested hooks library (with performance)
│   ├── proof-bank.md       — citable data/studies/quotes
│   ├── winners.md          — winners archive (>median performance)
│   ├── losers.md           — losers archive (lessons learned)
│   ├── voice-rules.md      — voice patterns discovered per run
│   ├── banned-patterns.md  — patterns ruled out per run
│   └── feedback-log.md     — 24h/72h learnings chronological
└── modules/
    └── templates/          — file templates for each run stage
        ├── content-object.md
        ├── idea.md
        ├── brief.md
        ├── draft-package.md
        └── feedback.md
```

## How information flows

1. **External signals** (Apify scrape of @superpowerapp + @mitohealth) and **Internal Knowledge** (future) feed → **Foundation** via stores/inbox.md
2. **Foundation** loads into every run: strategy + voice + pillars + avoid-slop + relevant stores
3. **Run** produces content following Foundation rules
4. **Feedback** updates stores → Foundation gets sharper

## When to update

| Trigger | Update |
|---|---|
| Posicionamento muda | `strategy.md` |
| Tom de voz evolui | `voice.md` |
| Novo pilar / pilar cai | `pillars.md` |
| Identifico padrão ruim em run | `master-avoid-slop.md` + `stores/banned-patterns.md` |
| Hook funciona (>median) | `stores/hooks.md` + `stores/winners.md` |
| Hook flopa | `stores/losers.md` + lesson em `stores/feedback-log.md` |
| Novo conta/site relevante surge | `source-watchlist.md` |
| Estudo/dado citável aparece | `stores/proof-bank.md` |

## Cross-references

- Existing top-level docs `LONGEVIFY_BRAND.md` and `LONGEVIFY_PILLARS.md` permanecem (não quebrar pipeline). Foundation **enriquece** sem duplicar — `voice.md` e `pillars.md` aqui referenciam os originais e adicionam camadas operacionais (avoid-slop, scoring rubric, stores).
