---
verifier_score: 11/12
writer_self_score: 11/12
score_delta: 0
verdict: revise
violations_grave: 0
violations_medium: 1
violations_light: 3
verified_at: 2026-05-14T19:30:07.070Z
---

# Verifier Report

**Final verdict: REVISE**
*LLM total 11/12 · medium violations (combined): 1*

## LLM Rubric (independent judge)

| Dimension | Score |
|---|---|
| Pillar alignment | 3/3 |
| Voice alignment | 3/3 |
| Avoid-slop pass | 2/3 |
| Hook strength | 3/3 |
| **Total** | **11/12** |

### Reasoning
O draft é tecnicamente sólido e demonstra domínio do Pilar 2. O paradoxo ferritina 'normal' vs performance está bem executado, o modo Mito domina com precisão (ng/mL, transferrina, saturação, hemólise), a Camada Equinox aparece nos hooks atléticos ('cadência que escorrega', 'longo que pesa do km 7') e os italics Aesop são pontuais e funcionam. O hook forte — paradoxo + número concreto (90 segundos) — segura os primeiros 2 segundos com stakes reais. Zero tom alarmista, zero promessa de cura, zero ataque nominal. O self-score de 11 é defensável em quase tudo.

A única violação que impede aprovação imediata está na caption: 'ela merece um número exato' é exatamente a construção 'você merece [algo]' do vocabulary banido (Cap 2), mesmo trocando 'você' por 'ela' — o padrão semântico é o mesmo e soa coaching/self-help numa peça que até aqui era dado-fria. É uma violação médio, que pelo rubric exige revisão. O subhead display também passa de 12 palavras, mas é violação leve. O hook_strength merece 3 (não 2 como o writer autoavaliou) — '90 segundos no 10k' como hipótese ilustrativa é justamente o que torna o stake tangível; a audiência de corredora amadora calibra isso contra experiência própria, o que é mais forte do que um dado citado fora de contexto.

## Programmatic scan

**Metrics:**
- Max em-dashes em um parágrafo: 7
- Exclamações no body: 0
- Emojis banidos encontrados: nenhum
- Linhas com CAPS LOCK: 5

**Violations detected:**
- Grave: nenhuma ✓
- **Medium:**
  - [llm] **ela merece um número exato** (Cap 2 — Vocabulary banido: 'você merece [algo]' / self-help register)
    > "E ela merece um número exato, não um carimbo de 'tudo certo'."
- **Light:**
  - [programmatic] `Em-dash count: 7 em 1 parágrafo (limite: 2)`
  - [programmatic] `5 linha(s) com CAPS LOCK (use italics)`
  - [llm] **Headline ligeiramente acima de 12 palavras no subhead** (Cap 9 / Voice.md — subhead como headline display excede 12 palavras (18 palavras))
    > "Entre o limite inferior do laboratório e o mínimo da sua performance, tem uma corredora exausta achando que é fraca."

## Score comparison

- Writer self-score: 11/12
- Verifier (LLM): 11/12
- Delta: 0



## Revision notes

- Caption — substituir 'ela merece um número exato, não um carimbo de tudo certo' por construção dado-fria sem registro de merecimento. Sugestão: 'Ferritina pede número exato. Carimbo de tudo certo não é resposta.' ou 'Não é carimbo de tudo certo. É um número, uma faixa, um protocolo.'
- Subhead display — condensar de 18 para máximo 12 palavras. Sugestão: 'Está no laudo. Ninguém te mostrou. E está custando performance.' (10 palavras, mantém a virada)
