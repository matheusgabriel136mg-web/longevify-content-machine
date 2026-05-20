# Runs — One folder per content object

Cada peça de conteúdo (post, reel, carrossel) vive em uma pasta isolada aqui. Lifecycle inteiro acontece em um único lugar: ideia → brief → draft → verifier → publish → feedback.

## Estrutura por run

```
runs/
├── README.md
├── _template/              # blank scaffolding — copy this
│   ├── content-object.md
│   ├── idea.md
│   ├── brief.md
│   ├── draft-package.md
│   └── feedback.md
└── YYYY-MM-DD-NNN-slug/    # one folder per content object
    ├── content-object.md   # route, state, next action (lifecycle hub)
    ├── idea.md             # idea gate decision + rationale
    ├── brief.md            # writer handoff packet
    ├── draft-package.md    # draft + verifier rubric output
    ├── feedback.md         # 24h/72h metrics + learnings
    └── assets/             # any media generated for this run
        ├── final.mp4
        ├── source.jpg
        └── ...
```

## How to create a new run

```bash
# Manual (Phase 1 — manual)
RUN_ID="2026-05-12-001-cortisol-brasileiro"
cp -R _template "$RUN_ID"

# Future (Phase 2 — orchestrator)
# Will be: node scripts/new-run.ts --from-inbox <inbox-entry-id>
```

## State lifecycle (in content-object.md frontmatter)

```
idea → brief → draft → verified → published → archived
```

A cada transição, atualizar:
- `state` field
- `next_action` field
- `updated_at` field
- log entry in "## State log"

## Naming convention

`YYYY-MM-DD-NNN-slug`

- Date = idea promoted (não published)
- NNN = sequence per day (001, 002...)
- slug = 2-4 palavras kebab-case que dizem a essência

Exemplos:
- `2026-05-10-001-painel-cardiovascular-cortisol`
- `2026-05-12-002-vitamina-d-tropico`
- `2026-05-15-001-falha-checkup-10min`

## When to archive

Move a run pra `runs/_archived/YYYY-Q/` quando:
- Publicado + 30 dias passados (feedback completo)
- Abandonado (state = archived, route = scrapped)

Stores acumulados (hooks, winners, losers) ficam em `foundation/stores/` — não dependem da run individual.
