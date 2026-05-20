---
content_object: 2026-05-17-004-vitamina-d-no-brasil-proto
writer: opus-4.7
format: post-1-slides
aspect: 4:5
protocol: stat-driven
target_metric: vsMedian >= 1.3
---

# Brief — STAT-DRIVEN curiosity (Function-inspired, single image)

## Tópico específico desta run
Vitamina D no Brasil tropical: 47 porcento dos brasileiros tem deficiencia mesmo com sol abundante. Numero grande gold centralizado, label pt-BR, fonte SBC ou IBGE-saude. Adaptacao do format SP single-stat curiosity (1.5x vsMedian Logging miles is one thing)

## Protocol enforced (do NOT deviate)

**Pillar:** 2
**Format:** post
**Slide count:** 1 (exato)

## Structure (slide-by-slide / scene-by-scene)
```json
[
  {
    "slide": 1,
    "role": "stat_hook",
    "elements": [
      "número_grande_centralizado_(stat)",
      "label_subline_curto_descrevendo_o_que_é_o_número",
      "fonte_micro_no_rodapé_(estudo_OU_guideline_BR_se_possível)",
      "ilustração_de_fundo_sutil_relacionada_(opcional)",
      "logo_longevify_bottom"
    ],
    "constraints": [
      "stat_em_DM_Sans_Light_300_OU_serif_italic_display_(96-160px)",
      "stat_pode_ter_~_OR_aproximação_explícita",
      "label_max_20_palavras",
      "fonte_obrigatória_(no_canvas_OU_caption)",
      "sem_pessoa_no_post"
    ],
    "examples_function": [
      "~41% of Americans are low in Vitamin D.",
      "Your body produces 2 million red blood cells every second."
    ],
    "examples_longevify_BR": [
      "47% dos brasileiros têm deficiência de vitamina D — mesmo no trópico.",
      "ApoB prevê 70% dos infartos. Colesterol total prevê 50%.",
      "30% da população BR tem hs-CRP acima de 1.0 — risco cardiovascular silencioso.",
      "Brasileiro consome 4x mais café que sueco. Mas tem 2x menos magnésio."
    ]
  }
]
```

## Voice
- Tone: Mito (precisão) + Aesop (concisão) + Function (curiosity hook)
- Forbidden: fear, alarmismo, estatísticas_sem_fonte, stats_americanas_não_adaptadas_pro_BR_(quando_há_dado_BR_disponível)

## Visual
```json
{
  "palette": {
    "bg": "#000F08",
    "stat_number": "#C89136",
    "label": "#f8fffc",
    "source": "#f8fffc 50% opacity",
    "illustration_bg": "#2D7A5C low opacity"
  },
  "typography": {
    "stat": "DM Sans Light 300 OR Source Serif Italic, 120-160px, gold, kerning -0.04em",
    "label": "DM Sans Light 300, 20-24px, off-white, line-height 1.4",
    "source": "DM Sans Regular 400, 11px, uppercase, off-white 50%, letter-spacing +0.08em"
  },
  "anti": [
    "stat_em_pure_white_card",
    "ícones_decorativos_grandes",
    "barras_de_gráfico_que_competem_com_o_número",
    "drop_shadows",
    "pessoa_na_imagem"
  ]
}
```

## Caption template
1 frase recontextualizando o stat. 2-3 frases sobre por que isso importa pro ICP brasileiro (pessoal, prático). 1 frase de fechamento que convida reflexão. Citar fonte no final. ~250-400 chars.

## Anti-patterns (auto-reject if found)
- ❌ stat_americana_apresentada_como_BR
- ❌ stat_sem_fonte
- ❌ stat_genérica_(50%_das_pessoas...)
- ❌ stat_que_implica_fear_('1_em_3_terá_câncer')

## Fact-check
OBRIGATÓRIO (rodar fact-check antes de verifier)

## Verifier targets
- Total score: ≥ 9/12
- Zero violações de voice.forbidden
- Slide count exatamente 1