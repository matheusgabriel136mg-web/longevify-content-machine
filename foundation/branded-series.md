# Branded Series — Identidade Recorrente

> Inspirado em @functionhealth, que tem 4+ branded series com badges ("QUICK QUESTION", "TRUE STORY", "OVERHEARD AT", "LONG LIVE MOMS"). Cria reconhecimento instantâneo no feed do seguidor.
>
> Longevify vai ter 4 branded series próprias com badges visuais consistentes.

## Series 1 — FAIXA FUNCIONAL

**Badge**: pill gold borda + texto uppercase letter-spacing +0.12em
**Frequência**: 1x/semana (sexta noite)
**Formato**: single image (protocolo `quick-question`)
**Conceito**: Pergunta provocativa em serif italic sobre uma faixa de biomarcador, contrastando faixa de laboratório vs faixa funcional Longevify.

**Exemplos:**
- "FAIXA FUNCIONAL: Seu ApoB está 95. Dentro da faixa do laboratório. *Por que ainda preocupa?*"
- "FAIXA FUNCIONAL: Ferritina 80 em homem atleta. *Você sabe por que isso pesa?*"
- "FAIXA FUNCIONAL: Sua insulina em jejum está 8. *Faixa lab é < 25. Mas e a faixa funcional?*"

**Por que funciona**: pergunta retórica + dado concreto. Engaja na hora (comment) e save (referência).

---

## Series 2 — CASO REAL

**Badge**: pill gold borda + texto uppercase
**Frequência**: 2x/mês (terça noite, alternando)
**Formato**: carrossel 5 slides (protocolo `caso-real`)
**Conceito**: Case study anonimizado mostrando contraste entre exame "normal" e biomarcador funcional fora da faixa, intervenção aplicada, resultado.

**Estrutura sempre igual:**
1. Hook em 2 frases contrastantes ("Cansaço persistente. Exames perfeitos.")
2. Queixa anonimizada (M., 42, executiva)
3. Biomarcador revelado + faixas
4. 3 intervenções numeradas
5. Resultado + CTA painel

**Por que funciona**: storytelling + dado + provoca "isso pode ser meu caso?". Disclaimer obrigatório de anonimização.

---

## Series 3 — DADO

**Badge**: pill gold borda + texto uppercase
**Frequência**: 1-2x/semana (quarta noite OU domingo)
**Formato**: single image (protocolo `stat-driven`)
**Conceito**: 1 estatística contraintuitiva grande no centro + label editorial breve. PREFERIR dado brasileiro (SBC, IBGE-saúde, estudos USP).

**Exemplos:**
- "47% dos brasileiros têm deficiência de vitamina D — mesmo no trópico."
- "ApoB prevê 70% dos infartos. Colesterol total prevê 50%."
- "Brasileiro consome 4x mais café que sueco. Mas tem 2x menos magnésio."

**Por que funciona**: número grande pega atenção, share rate alto (pessoas compartilham stat surpreendente).

---

## Series 4 — OVERHEARD NO BR (futuro)

**Badge**: pill gold borda
**Frequência**: 1x/quinzena
**Formato**: single image quote + atribuição
**Conceito**: Cultural moments brasileiros + tradução pra biomarcador (estilo "Overheard at Coachella" da Function).

**Exemplos potenciais:**
- "Overheard no Equinox": _"Faço crossfit há 4 anos. Por que ainda não me sinto melhor?"_ → reflexão sobre cortisol/recovery
- "Overheard no boteco": _"Sextou! Última cerveja, prometo."_ → reflexão sobre ALT/AST
- "Overheard na padaria": _"Pão francês, requeijão e café — clássico."_ → reflexão sobre glicose pós-prandial

**Por que funciona**: insight cultural + dado. Brasileiro se vê na cena, depois é provocado pela biologia.

**Status**: protocolo a construir (P2).

---

## Como usar

Cada protocolo na pasta `foundation/protocols/` referencia o `series_badge` correspondente. Quando o writer gera o slide cover, ele lê o badge e renderiza o pill correspondente.

Visual brief de cada protocolo já define paleta + tipografia + posição do badge.

## Cadência consolidada

| Dia | Post | Series |
|---|---|---|
| Segunda 11h | Carrossel | rotação Pilar 1-4 |
| Terça 19h | Reel | rotação livre OR CASO REAL |
| Quarta 19h | Carrossel ou single | DADO |
| Quinta 19h | Reel | rotação livre |
| Sexta 19h | Single image | FAIXA FUNCIONAL |
| Sábado | (stories only) | — |
| Domingo 10h | Carrossel premium | OVERHEARD NO BR OR pilar |

Total semanal: 7 posts feed + stories diários. **4 dos 7 são branded series** (60% de identidade recorrente).
