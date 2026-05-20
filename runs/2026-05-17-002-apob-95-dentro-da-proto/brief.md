---
content_object: 2026-05-17-002-apob-95-dentro-da-proto
writer: opus-4.7
format: post-1-slides
aspect: 4:5
protocol: quick-question
target_metric: vsMedian >= 1.3
---

# Brief — QUICK QUESTION (Function-inspired, single image)

## Tópico específico desta run
ApoB 95 dentro da faixa do laboratorio por que ainda preocupa

## Protocol enforced (do NOT deviate)

**Pillar:** 2
**Format:** post
**Slide count:** 1 (exato)

## Structure (slide-by-slide / scene-by-scene)
```json
[
  {
    "slide": 1,
    "role": "provocative_question",
    "elements": [
      "badge_pill_no_topo_centralizado_(gold_borda_uppercase_letter-spacing_aberto)",
      "pergunta_provocativa_em_serif_italic_display",
      "subline_editorial_max_15_palavras_off-white_60_opacity",
      "ilustração_micro_no_fundo_sutil_(opcional)",
      "logo_longevify_no_rodapé_centralizado"
    ],
    "constraints": [
      "max_12_palavras_pergunta",
      "italic_em_palavra-pivô_da_pergunta",
      "background_forest_solido_OU_microscopy_sutil_low_opacity",
      "pergunta_não_pode_ser_yes/no_simples_(precisa_provocar_reflexão)",
      "sem_imagem_de_pessoa_no_post"
    ],
    "examples_function": [
      "QUICK QUESTION: You're doing the work — so why isn't the scale moving?",
      "QUICK QUESTION: My annual physical tests glucose. Is that enough?",
      "QUICK QUESTION: Can time in the sun transform your health?"
    ],
    "examples_longevify_BR": [
      "FAIXA FUNCIONAL: Seu ApoB está 95. Dentro da faixa do laboratório. *Por que ainda preocupa?*",
      "FAIXA FUNCIONAL: Seu exame anual dosa colesterol total. *É suficiente?*",
      "FAIXA FUNCIONAL: Ferritina 80 em homem atleta. *Você sabe por que isso pesa?*"
    ]
  }
]
```

## Voice
- Tone: Mito (precisão) + Aesop (restrição) + Function (provocação editorial)
- Forbidden: fear, alarmismo, promessa, perguntas_retóricas_sem_dado_(precisa_ter_biomarcador_concreto_OU_referência_clínica)

## Visual
```json
{
  "palette": {
    "bg": "#000F08",
    "badge_border": "#C89136",
    "badge_text": "#C89136",
    "headline": "#f8fffc",
    "italic_pivot": "#C89136",
    "subline": "#f8fffc 60% opacity"
  },
  "typography": {
    "badge": "DM Sans Regular 400, uppercase, letter-spacing +0.12em, font-size 11px",
    "headline": "Georgia OR Source Serif Pro Light Italic 300, font-size 48-72px, line-height 1.15",
    "subline": "DM Sans Light 300, font-size 16px, line-height 1.5"
  },
  "layout_hints": [
    "badge_topo_5%_canvas",
    "headline_centro_vertical_max_75%_width",
    "subline_logo_abaixo_da_headline_mesma_largura",
    "logo_bottom_5%_padding"
  ],
  "anti": [
    "imagem_de_pessoa",
    "borders_visiveis_em_volta_do_card",
    "bullets",
    "DM_Sans_pra_headline_(precisa_serif)",
    "background_pure_white",
    "drop_shadows"
  ]
}
```

## Caption template
Reframe a pergunta em prosa editorial (2-3 frases). Dado/biomarcador que justifica a pergunta. Pergunta retórica de fechamento ou convite. Sem hashtags decorativos. ~300-500 chars.

## Anti-patterns (auto-reject if found)
- ❌ pergunta_genérica_sem_dado_concreto
- ❌ yes_no_question_simples
- ❌ fear_implícito_(que_seu_exame_pode_estar_te_traindo)
- ❌ 5_perguntas_para_X_format

## Fact-check
OBRIGATÓRIO (rodar fact-check antes de verifier)

## Verifier targets
- Total score: ≥ 9/12
- Zero violações de voice.forbidden
- Slide count exatamente 1