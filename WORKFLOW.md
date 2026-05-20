# Longevify Content Machine — Workflow

> **Como ver:** abre esse arquivo em qualquer markdown viewer com suporte Mermaid (VS Code, GitHub, Notion). Ou cola o bloco mermaid em [mermaid.live](https://mermaid.live) pra fullscreen.

---

## Visão geral — 4 camadas

```mermaid
flowchart TB
    classDef impl fill:#5BAE9E,stroke:#1C3F3A,stroke-width:2px,color:#0a1a0e
    classDef plan fill:#eef7f2,stroke:#7ab5a0,stroke-width:1px,stroke-dasharray:5 5,color:#1C3F3A
    classDef data fill:#f8fffc,stroke:#006070,stroke-width:1px,color:#0a1a0e
    classDef external fill:#0a1a0e,stroke:#5BAE9E,stroke-width:1px,color:#f8fffc

    %% ─── Foundation ────────────────────────────────
    subgraph FOUND["📘 FOUNDATION (input estratégico)"]
        BRAND["LONGEVIFY_BRAND.md<br/>paleta · tom · público"]:::impl
        PILLARS["LONGEVIFY_PILLARS.md<br/>4 pilares · ICP · anti-themes"]:::impl
    end

    %% ─── Layer 1: Intelligence ─────────────────────
    subgraph L1["🔍 LAYER 1 — Competitive Intelligence"]
        APIFY["Apify<br/>Instagram Scraper"]:::external
        SCRAPE["analyze-instagrams.ts<br/>rescrape-superpower.ts"]:::impl
        RAW[("raw-posts.json<br/>261 posts · 3 marcas")]:::data
        VIRALS[("top-virals.json<br/>87 virais")]:::data
        CL_AN["Claude Opus<br/>análise competitiva"]:::external
        ANALYSIS[("analysis.md<br/>5 hooks · 4 temas · 3 gaps")]:::data
    end

    %% ─── Layer 2: Visual DNA ───────────────────────
    subgraph L2["🎨 LAYER 2 — Visual DNA"]
        VDNA["visual-dna.ts"]:::impl
        GEMINI["Gemini 2.5 Flash Vision"]:::external
        VDNA_OUT[("visual-dna.json<br/>composição · paleta<br/>mood · prompt EN")]:::data
    end

    %% ─── Layer 3: Generation ───────────────────────
    subgraph L3["⚙️ LAYER 3 — Generation Pipeline"]
        GEN_POST["Claude Opus<br/>generate posts pt-BR"]:::external
        GEN_VIS["generate visual prompts"]:::impl
        FAL["fal.ai<br/>Flux · NB · GPT Image"]:::external
        VIDEO["Kling v3 · Veo 3 · Seedance"]:::external
        POSTS[("3 posts pt-BR<br/>+ images + videos")]:::data
    end

    %% ─── Layer 4: Validation ───────────────────────
    subgraph L4["🧠 LAYER 4 — Validation"]
        BSC3["brain-score-big3.ts<br/>(benchmark concorrentes)"]:::impl
        OPT["viral-optimizer.py"]:::impl
        TRIBE["TRIBE v2<br/>Facebook fMRI model"]:::external
        SCORES[("brain-scores<br/>visual · emoção<br/>memória · social")]:::data
        EDITOR["editor-agent<br/>(planned)"]:::plan
    end

    PUBLISH(["📤 Ship to Instagram"]):::impl

    %% ─── Edges ─────────────────────────────────────
    APIFY --> SCRAPE
    SCRAPE --> RAW
    RAW --> CL_AN
    RAW --> VIRALS
    CL_AN --> ANALYSIS

    RAW --> VDNA
    VDNA --> GEMINI
    GEMINI --> VDNA_OUT

    BRAND --> GEN_POST
    PILLARS --> GEN_POST
    ANALYSIS --> GEN_POST
    VIRALS --> GEN_POST
    GEN_POST --> GEN_VIS
    VDNA_OUT --> GEN_VIS
    GEN_VIS --> FAL
    GEN_VIS --> VIDEO
    FAL --> POSTS
    VIDEO --> POSTS

    %% Validation
    RAW --> BSC3
    BSC3 --> OPT
    POSTS --> OPT
    OPT --> TRIBE
    TRIBE --> SCORES
    SCORES --> EDITOR
    EDITOR -.->|"score < 70<br/>reject"| GEN_POST
    EDITOR -.->|"score ≥ 70<br/>approve"| PUBLISH
    SCORES -->|"benchmark"| GEN_POST
```

---

## Status por componente

| Camada | Componente | Status | Arquivo |
|--------|-----------|--------|---------|
| **Foundation** | Brand book | ✅ | `LONGEVIFY_BRAND.md` |
| **Foundation** | Content pillars | ✅ | `LONGEVIFY_PILLARS.md` |
| L1 | Scrape Apify | ✅ | `scripts/analyze-instagrams.ts` |
| L1 | Re-scrape per brand | ✅ | `scripts/rescrape-superpower.ts` |
| L1 | Claude analysis | ✅ | `scripts/analyze-instagrams.ts` |
| L2 | Visual DNA Gemini | ✅ rodando agora | `scripts/visual-dna.ts` |
| L3 | Pipeline orquestrador | ✅ | `pipeline.ts` |
| L3 | Generate posts | ✅ | `pipeline.ts` (step 3) |
| L3 | Generate visual prompts | ✅ | `pipeline.ts` (step 4) |
| L3 | fal.ai images | ✅ | `pipeline.ts` (step 5) |
| L3 | Vídeo (Kling/Veo/Seedance) | ✅ opt-in | `pipeline.ts` (step 6) |
| L4 | Brain-score solo | ✅ | `scripts/viral-optimizer.py` |
| L4 | Brain-score Big 3 | ✅ rodando agora | `scripts/brain-score-big3.ts` |
| L4 | Editor agent (gate) | ⏳ planned | — |

---

## O que falta integrar

1. **Plugar `LONGEVIFY_PILLARS.md` no `pipeline.ts`** — hoje só `BRAND.md` é injetado em generate-posts. 5 linhas de mudança.
2. **Editor agent** — gate de qualidade entre `generate posts` e `Ship`. Lê pillars + brand + score, devolve aprovado/reprovado com correções específicas.
3. **Loop de feedback `brain-score → generate-posts`** — usar score do Big 3 como benchmark; gerar posts até score ≥ benchmark.

---

## Comandos rápidos

```bash
cd Brand/Longevify/content-machine

# Layer 1
npm run analyze-instagrams                    # scrape + ranqueia + Claude analysis
node ... rescrape-superpower.ts <dir>         # re-scrape uma marca com limite alto

# Layer 2
npm run visual-dna                            # virais das 3 marcas
npm run visual-dna -- --brand=Superpower      # todos os posts de uma marca

# Layer 3
npm run                                       # pipeline completa (gera posts + img)
GENERATE_VIDEO=true npm run                   # com vídeo

# Layer 4
npm run brain-score -- caminho/asset.png      # uma asset
npm run brain-score-big3                      # benchmark dos concorrentes (top 5/marca)
```
