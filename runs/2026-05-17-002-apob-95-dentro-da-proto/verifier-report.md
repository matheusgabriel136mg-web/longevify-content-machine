---
verifier_score: 11/12
writer_self_score: 11/12
score_delta: 0
verdict: approved
violations_grave: 0
violations_medium: 0
violations_light: 3
verified_at: 2026-05-17T21:09:35.751Z
---

# Verifier Report

**Final verdict: APPROVED**
*LLM 11/12, no grave, ≤1 medium*

## LLM Rubric (independent judge)

| Dimension | Score |
|---|---|
| Pillar alignment | 3/3 |
| Voice alignment | 3/3 |
| Avoid-slop pass | 3/3 |
| Hook strength | 2/3 |
| **Total** | **11/12** |

### Reasoning
O draft executa Pilar 2 com precisão clínica: ApoB 95 como biomarcador escondido, com diferenciação explícita entre faixa estatística e faixa de risco cardiovascular ótimo (80 / 60 mg/dL). Nenhum tom alarmista — o framing é epistêmico ('de qual faixa estamos falando'), não 'você pode infartar'. Modo Mito está dominante (número, mecanismo, distinção técnica) com acento Aesop correto — italic restrito a uma frase-pivô. CTA é convite, não ordem. Sem vocabulário banido, sem AI tells, sem emojis, sem promessa de cura, sem ataque nominal a médico.

A única violação light detectada é headline com contagem acima de 12 palavras (conta ~13 considerando o badge como parte do título). O hook cria tensão real via paradoxo 'dentro da faixa / por que preocupa' — sólido, embora o writer acertou ao notar que stakes poderiam ser mais viscerais (o body/caption resolve isso com 'aos 30, magro, atleta'). Score 11/12 do writer é justificado; concordamos com 11.

## Programmatic scan

**Metrics:**
- Max em-dashes em um parágrafo: 4
- Exclamações no body: 0
- Emojis banidos encontrados: nenhum
- Linhas com CAPS LOCK: 6

**Violations detected:**
- Grave: nenhuma ✓
- Medium: nenhuma ✓
- **Light:**
  - [programmatic] `Em-dash count: 4 em 1 parágrafo (limite: 2)`
  - [programmatic] `6 linha(s) com CAPS LOCK (use italics)`
  - [llm] **Headline acima de 12 palavras** (Voice — Headline: 6-12 palavras)
    > "FAIXA FUNCIONAL: Seu ApoB está 95. Dentro da faixa do laboratório. *Por que ainda preocupa?*"

## Score comparison

- Writer self-score: 11/12
- Verifier (LLM): 11/12
- Delta: 0



## Revision notes (N/A)

- Headline está borderline longa (~13 palavras). Considerar comprimir: 'ApoB 95. Dentro da faixa. *Por que ainda preocupa?*' — mantém paradoxo, perde badge como parte do título, ganha economia.
- O body/caption carrega o stake mais visceral ('aos 30, magro, atleta — 95 não é normal'). Considerar antecipar uma versão sintética disso na subline do visual para quem não lê caption.
- Sem outras revisões necessárias. Copy está pronto para publicação.
