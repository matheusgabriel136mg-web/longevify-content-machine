# BRAND_DEFAULTS.md — Opinionated decisions, no more "A ou B?"

> Este arquivo elimina o ping-pong de decisões repetitivas. Para qualquer "qual cor?", "qual hook?", "qual format?", o pipeline consulta este doc PRIMEIRO. Se a resposta está aqui, decide sozinho sem perguntar.
>
> Override sempre permitido: usuário pode contradizer e o sistema documenta a exceção no run específico.

## Defaults visuais

| Decisão | Default | Reason |
|---|---|---|
| **Background primary** | `#1C3F3A` (forest médio, paleta primária Longevify) | Atualizado 17/mai/2026 — antes era `#000F08` mas Matheus achou "muito escuro". `#1C3F3A` é o forest editorial respirável. |
| **Background ultra-dark** (uso específico) | `#000F08` (deep forest black) | Para stories/cinematográfico onde precisa contraste máximo (microscopy, etc.) |
| **Texto principal** | `#f8fffc` (off-white) | NUNCA `#FFFFFF` pure white |
| **Accent gold** | `#C89136` | Numeração editorial, sublinhados, micro-footer |
| **Verde acento** | `#2D7A5C` (emerald), `#557D6D` (teal), `#91B69D` (sage) | Hierarchy do mais saturado pro mais claro |
| **Cores PROIBIDAS** | red, amber, orange, pure white #FFFFFF | Sem exceção |
| **Aspect carrossel** | 4:5 (1080x1350) | IG feed |
| **Aspect reel** | 9:16 (1080x1920) | IG/TikTok |
| **Aspect story** | 9:16 (1080x1920) | IG |
| **Logo file** | `attached_assets/logo_horizontal_white_1773668692240.png` (3290x912 puro horizontal) | NUNCA o 2000x2000 stacked |
| **Logo width** | 28% do canvas no cover, 25% nos slides internos | Centralizado bottom |
| **Logo position** | Bottom-center, padding ~5% | Único spot |

## Defaults tipográficos

| Decisão | Default |
|---|---|
| **Fonte principal** | DM Sans (Light 300 pra display, Regular 400 pra numeração) |
| **Letter-spacing display** | -0.02em (slight tighten) |
| **Letter-spacing footer micro** | +0.08em (slight open, uppercase) |
| **Italic** | Georgia italic só pra blocos editoriais (paragraphs poéticos), NUNCA pra headlines |

## Defaults de copy

| Decisão | Default |
|---|---|
| **Idioma** | pt-BR único. Inglês só pra termos consagrados (hs-CRP, ApoB) |
| **Tom** | Mito (precisão técnica) + Aesop (restrição editorial). Nunca self-help, nunca fear, nunca promessa |
| **Hook length** | Máx 90 chars |
| **Title slide** | Máx 4 palavras |
| **Body slide** | Máx 25 palavras |
| **Caption** | Editorial, sem hashtags decorativos, máx 800 chars |
| **CTA** | Convite, não imperativo. "Link na bio" > "CLIQUE AQUI" |
| **Emojis** | Zero (exceto eventuais 🇧🇷 ou ❄️ se contextualmente raro) |

## Defaults de format

| Pilar | Format default | Reason |
|---|---|---|
| 1 — Terroir BR | Carrossel (5 slides) | Sequência narrativa cultural |
| 2 — Biomarcador escondido | Carrossel (5-7 slides) | Dado precisa de espaço editorial |
| 3 — Falha do check-up | Reel (15-20s) | Punch curto |
| 4 — Da sensação ao dado | Carrossel (5 slides) | Sentimento → biológico |

Override permitido se brief argumentar bem.

## Defaults de pillar selection

Em **idea-calendar** auto:
- Olha cota do mês
- Escolhe pilar mais atrasado vs quota
- Se empate: prioriza Pilar 2 (engagement histórico mais alto)

## Defaults de QA

Em **visual-qa**:
- Score ≥ 8 + zero high-severity issues → **pass**
- Score 5-7 + bug solúvel via prompt → **retry** (max 1x default)
- Score < 5 → **escalate** humano

## Defaults de publish

### Cadência semanal (locked)

| Dia | Tipo | Horário | Format |
|---|---|---|---|
| Segunda | Post feed | 11h BRT | Carrossel |
| Terça | Reel | 19h BRT | Reel (vídeo) |
| Quarta | Post feed | 19h BRT | Carrossel |
| Quinta | Reel | 19h BRT | Reel (vídeo) |
| Sexta | Post feed | 19h BRT | Single image / quote |
| Sábado | (descanso feed) | — | Só stories |
| Domingo | Carrossel premium | 10h BRT | Carrossel alta produção |

**Total semanal**: 4 feed (3 carrossel + 1 single) + 2 reels + 1 carrossel premium = **7 posts** + **9-10 stories**.

- **Cross-post**: feed carousel → também split em 5 stories de 4-5s cada (auto via `ig-story-split.ts`)
- **Reels têm prioridade no algoritmo 2026** — 3-5x mais reach orgânico que carrossel

## Defaults de error handling

- **higgsfield falhou em 1 slide**: tenta 1x mais, depois escala
- **writer JSON inválido**: tenta 1x mais com prompt "retorne JSON puro", depois escala
- **Apify timeout no competitor-scan**: skip a conta que falhou, segue com as outras
- **Cloudinary upload falhou**: escala (sem fallback automático)

## Exceções

Quando override necessário, documentar em `<run>/decision-log.md`:
```
[2026-05-13] Pilar 2 — Watch List — overrode default carrossel-5 pra carrossel-7 porque eram 5 marcadores + cover + cta editorial.
```
