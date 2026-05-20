# Brief — FAIXA FUNCIONAL · 03 · Glicose Pós-Prandial

## Identificadores
- run_id: 2026-05-22-001-faixa-funcional-glicose
- slot: 2026-05-22T19:00:00-03:00 (Sexta, 19h BRT)
- format: image (single, 4:5 · 1080x1350)
- series: FAIXA FUNCIONAL
- series_index: 03
- pillar: 2 — Biomarcador escondido
- state: draft

## Origem (bookmark)
Function Health, post sobre glicose pós-prandial. Tese central: glicose de jejum < 100 mg/dL é classificada como "normal", mas picos pós-refeição > 140 mg/dL geram glicação silenciosa de tecidos. Faixa funcional é mais apertada que faixa laboratorial — jejum 70–90, pós-refeição < 120. Adultos vivendo no corredor 91–99 (ainda "normal" no laudo) acumulam dano por glicação sem aviso clínico. O número não mudou. A leitura mudou.

## Tese da peça
Um biomarcador entrega dois números diferentes dependendo de quando você mede. O laboratório usa um critério desenhado para diagnosticar diabetes — não para preservar tecido. A faixa funcional é mais estreita porque o objetivo é outro: prevenir glicação, não confirmar doença.

## Tradução para o BR
- Glicemia de jejum é exame de rotina no Brasil (Fleury, DASA, Sabin, Hermes Pardini). Glicemia pós-prandial e curva glicêmica são pedidas com menos frequência.
- Faixa de referência ADA usada no laudo BR: jejum < 100 = "normal", pós-prandial < 140 = "normal".
- Faixa funcional citada por longevity practitioners: jejum 70–90, pós-prandial < 120.
- Custo CGM (Freestyle Libre) BR: R$ 220–280 por sensor de 14 dias. Acesso direto, sem prescrição em farmácia.

## Hooks testados
1. "O número não mudou. A leitura mudou." — paradoxo editorial (escolhido)
2. "Jejum 96. Pós-almoço 152." — choque numérico
3. "Seu laudo diz normal. Seu tecido discorda." (descartado: levemente alarmista)
4. "Glicose tem dois números." (descartado: morno, abre pouco)

**Hook escolhido:** #1. Razão: paradoxo limpo, encapsula a tese inteira em uma linha, funciona como caption e como over-image. Sustenta o reveal da tabela sem queimar o ponto técnico.

## Restrições de voz
- ZERO self-help, ZERO fear, ZERO promessa de cura
- ZERO persona-específica
- pt-BR puro, sem anglicismos não-clínicos (mantemos "glicose", "glicação", "pós-prandial")
- Tom Aesop poster + precisão Mito
- Tabela como diagrama editorial, não como infográfico publicitário

## Restrições visuais
- BG: #1C3F3A (forest médio Longevify)
- Texto: #f8fffc (off-white, nunca pure white)
- Accent gold: #C89136 (números-âncora + label "FAIXA FUNCIONAL · 03")
- Sage acento: #557D6D (linha divisora vertical entre colunas)
- Tipografia: DM Sans Light 300 display gigante (números), DM Sans Regular 400 (labels), Georgia Italic (footer editorial)
- Logo: bottom-center, 28% width (cover)
- Padding: 5% das bordas
- Sem fotografia. Sem ícone. Só tipografia + linha divisora.

## Identidade de série (consistência com ApoB anterior)
- Mesma badge top em gold uppercase com numeração da série
- Mesma estrutura de tabela 2-colunas: FAIXA LABORATÓRIO × FAIXA FUNCIONAL
- Mesma hierarquia: nome do biomarcador → tabela → footer editorial
- Mesma assinatura visual: logo centralizado bottom

## Score (interno)
- Hook strength: 9/10 (paradoxo limpo, memorável, postável)
- Pillar fit: 10/10 (biomarcador escondido com leitura dupla é o pilar 2 puro)
- Series fit: 10/10 (tabela funcional × laboratório é a espinha da série)
- Risk de fear: 2/10 (baixo — peça é editorial, não alarma)
- **Score composto: 9.0/10**

## Sucesso = verificável
- [ ] Badge top "FAIXA FUNCIONAL · 03" em gold uppercase letter-spacing +0.08em
- [ ] Nome do biomarcador "GLICOSE PÓS-PRANDIAL" em DM Sans 400 center-left
- [ ] Tabela 2-colunas com números gigantes em gold (< 140 vs < 120)
- [ ] Linha divisora vertical sage entre colunas
- [ ] Footer editorial 2 linhas em Georgia italic
- [ ] Logo bottom-center, 28% width
- [ ] Caption 4–6 linhas editorial, paradoxo "número igual, leitura diferente"
- [ ] Zero emoji, zero hashtag, zero promessa de cura, zero persona
