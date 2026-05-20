# Internal Inputs — second brain ingestion

> Drop arquivos aqui. O knowledge-ingest processa, classifica e alimenta `foundation/stores/inbox.md`.

## Formatos suportados

- **Texto:** `.md`, `.txt` (notas, transcrições prontas, brain dumps)
- **Áudio:** `.m4a`, `.mp3`, `.wav`, `.ogg`, `.mp4`, `.webm` (voice memos → transcrição via Whisper PT-BR)

## Fluxo

```
internal-inputs/                  ← você dropa aqui
├── README.md
├── ideia-cortisol.md
├── voice-memo-2026-05-10.m4a
└── processed/                    ← arquivos movidos pra cá após processamento
    ├── ideia-cortisol.md
    ├── voice-memo-2026-05-10.m4a
    ├── voice-memo-2026-05-10.transcript.md   ← transcript cacheado
    └── .classifications/                       ← JSON detalhado de cada classificação
        └── ideia-cortisol.md.json
```

## Uso

```bash
pnpm knowledge-ingest                # processa tudo aqui
pnpm knowledge-ingest --dry-run      # plano sem API calls
pnpm knowledge-ingest --file <path>  # 1 arquivo específico
```

## O que acontece

1. Whisper transcreve áudio (se aplicável)
2. Claude (Sonnet por default) classifica:
   - vale a pena salvar? (high bar — rejeita generic health-tech)
   - quais insights tem dentro? (1 arquivo pode ter N insights)
   - qual pilar? qual rota (ORIGINAL/REPURPOSE/RESEARCH)?
   - hook quality + priority
3. Se vale a pena: appenda em `foundation/stores/inbox.md` com entry estruturado
4. Move arquivo pra `processed/` (idempotência)

## Custo aproximado

- Whisper (áudio): $0.006/min
- Claude Sonnet (classificação cacheada): ~$0.01-0.03 por arquivo
