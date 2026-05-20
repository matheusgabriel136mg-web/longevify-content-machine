---
verifier_score: 10/12
writer_self_score: 11/12
score_delta: -1
verdict: revise
violations_grave: 0
violations_medium: 2
violations_light: 5
verified_at: 2026-05-14T19:30:40.546Z
---

# Verifier Report

**Final verdict: REVISE**
*LLM total 10/12 · medium violations (combined): 2*

## LLM Rubric (independent judge)

| Dimension | Score |
|---|---|
| Pillar alignment | 3/3 |
| Voice alignment | 3/3 |
| Avoid-slop pass | 2/3 |
| Hook strength | 2/3 |
| **Total** | **10/12** |

### Reasoning
The draft is genuinely strong: Pilar 2 alignment is textbook, every slide delivers faixa funcional + fisiologia + sintoma atlético, and the Mito voice is well-executed with precise terminology (ApoB ≠ colesterol, hiperinsulinemia compensatória, janela estreita IGF-1). Aesop italics land cleanly without being overwrought. Visual brief is detailed and self-consistent.

The single medium violation is the IGF-1 slide's phrase 'Muito alto sinaliza risco oncológico de longo prazo' — this crosses into fear-mongering territory that the master-avoid-slop explicitly prohibits. The brand promises clarity and anticipation, never alarm. Flagging oncological risk without the safety net of a supervised context (and without Longevify's AI framing defusing it) reads as a clinical scare rather than a data point. It can be rewritten as a precision framing ('janela estreita — performance e longevidade respondem melhor dentro dela') without losing the informational core. The two light violations (divider line in CTA and 'Salva pra pedir') are minor but worth tightening, especially since the divider rule is an explicit visual prohibition in the brand system.

## Programmatic scan

**Metrics:**
- Max em-dashes em um parágrafo: 6
- Exclamações no body: 0
- Emojis banidos encontrados: nenhum
- Linhas com CAPS LOCK: 10

**Violations detected:**
- Grave: nenhuma ✓
- **Medium:**
  - [programmatic] `transforme sua vida`
  - [llm] **Slide 7 copy: 'Muito alto sinaliza risco oncológico de longo prazo'** (Cap 3 — Tom proibido / Cap 2 — Fear-mongering adjacente)
    > "Muito alto sinaliza risco oncológico de longo prazo. Muito baixo, sub-recuperação crônica."
- **Light:**
  - [programmatic] `salve este post`
  - [programmatic] `Em-dash count: 6 em 1 parágrafo (limite: 2)`
  - [programmatic] `10 linha(s) com CAPS LOCK (use italics)`
  - [llm] **CTA separator: 'separado por linha fina gold' — contradicts visual rule on dividers** (Cap 4 — Linha horizontal divisora dentro de cards (proibido))
    > "CTA (rodapé, DM Sans Light 300, off-white, separado por linha fina gold)"
  - [llm] **Caption closing: 'Salva pra pedir no próximo exame' — borderline 'Salve este post' pattern** (Cap 4 — 'Salve este post para ler depois!' — manipulativo)
    > "Salva pra pedir no próximo exame."

## Score comparison

- Writer self-score: 11/12
- Verifier (LLM): 10/12
- Delta: -1



## Revision notes

- Rewrite IGF-1 insight: remove 'risco oncológico de longo prazo' — reframe as precision-window logic without fear trigger. Example: 'IGF-1 tem janela estreita porque responde a estímulos em duas direções. Fora da faixa funcional — pra cima ou pra baixo — a adaptação para. O número não basta isolado; o contexto de carga e idade biológica é o que fecha a leitura.'
- Remove the 'linha fina gold' divider from the Slide 7 CTA footer — use typographic spacing alone (padding) to separate CTA from body. The divider rule is an explicit visual ban in Cap 4.
- Soften 'Salva pra pedir no próximo exame' — it sits too close to the banned 'Salve este post para ler depois!' pattern. Replace with an implicit invitation: 'No próximo exame, esses cinco já têm nome.' or remove entirely and let the list close on the IGF-1 insight.
