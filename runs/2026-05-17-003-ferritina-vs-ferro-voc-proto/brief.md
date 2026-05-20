---
content_object: 2026-05-17-003-ferritina-vs-ferro-voc-proto
writer: opus-4.7
format: carousel-6-slides
aspect: 4:5
protocol: p2-biomarcador-deep-dive
target_metric: vsMedian >= 1.3
---

# Brief — Biomarcador Deep Dive (carrossel 6 slides)

## Tópico específico desta run
Ferritina vs Ferro: você pode estar deficiente em ferro com ferro normal no exame. O exame padrão pede ferro. Mas pula o número que realmente conta - a ferritina. Adaptação do post viral Mito Health (5.0x vsMedian) com pattern lab range vs functional range. Carrossel 5-6 slides em paleta forest+gold, voz Mito+Aesop, ICP atleta BR

## Protocol enforced (do NOT deviate)

**Pillar:** 2
**Format:** carousel
**Slide count:** 6 (exato)

## Structure (slide-by-slide / scene-by-scene)
```json
[
  {
    "slide": 1,
    "role": "hook_cover",
    "elements": [
      "narrativa_cenario_real",
      "biomarcador_nomeado"
    ]
  },
  {
    "slide": 2,
    "role": "data_reveal",
    "elements": [
      "numero_exato",
      "ranges_lado_a_lado"
    ]
  },
  {
    "slide": 3,
    "role": "mechanism",
    "elements": [
      "o_que_acontece_no_corpo",
      "linguagem_acessivel"
    ]
  },
  {
    "slide": 4,
    "role": "longevify_functional_range",
    "elements": [
      "faixa_funcional",
      "porque_diferente_do_lab"
    ]
  },
  {
    "slide": 5,
    "role": "context",
    "elements": [
      "ICP_relatable",
      "sintoma_atletico"
    ]
  },
  {
    "slide": 6,
    "role": "cta",
    "elements": [
      "pergunta_retorica",
      "logo"
    ]
  }
]
```

## Voice
- Tone: Mito + Aesop
- Forbidden: fear, diagnostico

## Visual
```json
{
  "palette": {
    "bg": "#000F08",
    "text": "#f8fffc",
    "accent_gold": "#C89136"
  }
}
```

## Caption template
1 frase hook editorial. 3-4 frases contextualizando. Pergunta retórica que convida pra próximo exame. Sem hashtags.

## Anti-patterns (auto-reject if found)
- ❌ promessa
- ❌ fear
- ❌ 5_passos_de_X

## Fact-check
OBRIGATÓRIO (rodar fact-check antes de verifier)

## Verifier targets
- Total score: ≥ 9/12
- Zero violações de voice.forbidden
- Slide count exatamente 6