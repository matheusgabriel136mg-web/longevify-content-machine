---
content_object: 2026-05-17-005-m-42-executivo-paulistano-proto
writer: opus-4.7
format: carousel-5-slides
aspect: 4:5
protocol: caso-real
target_metric: vsMedian >= 1.3
---

# Brief — CASO REAL (Function TRUE STORY-inspired, carrossel 5)

## Tópico específico desta run
M, 42, executivo paulistano. Cansaco persistente, exames normais. Cortisol elevado + debito de sono. Pattern de Function viral Shortcuts dont replace fundamentals 11.8x vsMedian. Estrutura contraste 2 frases: Sono ruim. Exames normais. Anonimizacao obrigatoria. Voz Mito+Aesop+Function transparency

## Protocol enforced (do NOT deviate)

**Pillar:** 3
**Format:** carousel
**Slide count:** 5 (exato)

## Structure (slide-by-slide / scene-by-scene)
```json
[
  {
    "slide": 1,
    "role": "hook_caso",
    "elements": [
      "badge_CASO_REAL_topo",
      "hook_2_palavras_contraste_(estilo_'Sono ruim. Exames normais.')",
      "subline_anonimizada_descrevendo_o_caso"
    ],
    "constraints": [
      "hook_max_5_palavras_total",
      "estrutura_contraste_(X bom. Y ruim.)",
      "anonimização_obrigatória_(M., 42, executiva — não nome real)"
    ],
    "examples_function": [
      "Poor sleep. Normal labs.",
      "From Stress to Skin Reaction"
    ],
    "examples_longevify": [
      "Cansaço persistente. Exames perfeitos.",
      "PR estagnado. Hemograma OK.",
      "Brain fog crescente. T4 normal."
    ]
  },
  {
    "slide": 2,
    "role": "queixa_em_detalhe",
    "elements": [
      "narrativa_da_pessoa_em_1a_pessoa_anonimizada",
      "sintoma_específico_descrito",
      "tempo_de_persistência"
    ],
    "constraints": [
      "max_30_palavras",
      "italic_em_palavra-pivô",
      "sem_diagnóstico_implícito",
      "tom_aesop_(restrição_editorial)"
    ]
  },
  {
    "slide": 3,
    "role": "biomarcador_revelado",
    "elements": [
      "nome_biomarcador",
      "valor_paciente",
      "faixa_laboratorio_vs_faixa_funcional_lado_a_lado",
      "porque_o_exame_anual_não_pegou"
    ],
    "constraints": [
      "número_destacado_em_gold_grande",
      "comparison_visual_claro",
      "fonte_da_faixa_funcional_(estudo_OU_guideline)"
    ]
  },
  {
    "slide": 4,
    "role": "protocolo_aplicado",
    "elements": [
      "3_intervenções_específicas_numeradas_gold",
      "duração_(ex: 60 dias)",
      "sem_supplements_comerciais_específicos"
    ],
    "constraints": [
      "max_3_bullets",
      "cada_bullet_max_15_palavras",
      "intervenções_baseadas_em_evidência_(não_biohack_sem_estudo)"
    ]
  },
  {
    "slide": 5,
    "role": "resultado_cta",
    "elements": [
      "antes_vs_depois_do_biomarcador",
      "1_frase_sobre_como_a_pessoa_se_sente",
      "convite_implícito_painel_Longevify",
      "logo_centralizado"
    ],
    "constraints": [
      "número_resultado_em_gold_grande",
      "sem_promessa_que_vai_funcionar_pra_todo_mundo",
      "cta_'seu painel pode mostrar o seu CASO REAL'"
    ]
  }
]
```

## Voice
- Tone: Mito (precisão clínica) + Aesop (restrição narrativa) + Function (case study transparency)
- Forbidden: depoimento_emocional_exagerado, promessa_implícita, atacar_médico_que_pediu_o_exame_anual, diagnóstico_à_distância_da_audiência

## Visual
```json
{
  "palette": {
    "bg": "#000F08",
    "badge": "#C89136",
    "text": "#f8fffc",
    "number_destaque": "#C89136"
  },
  "typography": {
    "badge": "DM Sans Regular 400, uppercase, +0.12em",
    "headline_hook": "DM Sans Light 300 OR serif italic, 48-64px",
    "number_biomarcador": "DM Sans Light 300, 96-128px, gold",
    "body": "DM Sans Light 300, 18px, line-height 1.5"
  },
  "anti": [
    "foto_de_pessoa_real",
    "antes_e_depois_de_rosto",
    "ilustração_decorativa_de_pessoa",
    "drop_shadows",
    "bullets_com_check_verde"
  ]
}
```

## Caption template
1 frase editorial recapitulando o contraste. 2-3 frases sobre o que isso significa pro ICP brasileiro. 1 pergunta que convida pra DM 'painel' OU link na bio. Disclaimer micro no final: 'Caso anonimizado. Cada protocolo é individual.' Sem hashtags decorativos.

## Anti-patterns (auto-reject if found)
- ❌ depoimento_que_parece_AD
- ❌ antes_e_depois_genérico
- ❌ promessa_de_que_qualquer_um_vai_ter_o_mesmo_resultado
- ❌ exagerar_drama_do_caso
- ❌ criticar_médico_individual

## Fact-check
OBRIGATÓRIO (rodar fact-check antes de verifier)

## Verifier targets
- Total score: ≥ 9/12
- Zero violações de voice.forbidden
- Slide count exatamente 5