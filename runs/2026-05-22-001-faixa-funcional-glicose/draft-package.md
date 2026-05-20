# Draft Package — FAIXA FUNCIONAL · 03 · Glicose Pós-Prandial

**Run ID:** 2026-05-22-001-faixa-funcional-glicose
**Slot:** Sexta, 22/mai/2026, 19h BRT
**Format:** Single image · 4:5 · 1080x1350
**Series:** FAIXA FUNCIONAL (entrada 03)
**Pilar:** 2 — Biomarcador escondido
**State:** draft

---

## 1. Conceito da peça

Glicose é um único biomarcador que entrega duas leituras diferentes — uma quando o estômago está vazio, outra duas horas depois da refeição. O laudo brasileiro classifica como "normal" o que a literatura de longevidade já considera dano acumulado em silêncio. A peça coloca lado a lado o número que o laboratório aceita e o número que o tecido aceita. Sem persona, sem alarme. Tabela editorial.

**Tese em uma linha:** O número não mudou. A leitura mudou.

---

## 2. Estrutura visual (single image)

Layout vertical 4:5 dividido em quatro zonas com padding 5% nas bordas.

### TOP (0–18% da altura)
- Badge: `FAIXA FUNCIONAL · 03`
- Estilo: DM Sans Regular 400 uppercase
- Cor: `#C89136` (gold)
- Letter-spacing: +0.08em
- Tamanho: ~22px
- Alinhamento: centralizado horizontalmente

### NOME DO BIOMARCADOR (18–30% da altura)
- Texto: `GLICOSE PÓS-PRANDIAL`
- Estilo: DM Sans Regular 400 uppercase
- Cor: `#f8fffc` (off-white)
- Letter-spacing: +0.04em
- Tamanho: ~38px
- Alinhamento: center-left, com indentação de ~8% do padding interno
- Subtítulo logo abaixo (DM Sans Regular 400, 16px, `#557D6D` sage): `medida 2 horas após a refeição`

### TABELA CENTRAL DOMINANTE (30–72% da altura)
Duas colunas separadas por uma linha vertical fina sage `#557D6D` (1px). Cada coluna com label superior + número gigante.

**Coluna esquerda — FAIXA LABORATÓRIO**
- Label (topo): `FAIXA LABORATÓRIO`
  - DM Sans Regular 400 uppercase, `#f8fffc` a 70% opacidade, letter-spacing +0.06em, ~16px
- Número-âncora: `< 140`
  - DM Sans Light 300, `#C89136` (gold), ~160px
- Unidade: `mg/dL`
  - DM Sans Regular 400, `#f8fffc`, ~22px, logo abaixo do número
- Caption sub: `referência ADA`
  - Georgia Italic, `#557D6D`, ~14px

**Coluna direita — FAIXA FUNCIONAL**
- Label (topo): `FAIXA FUNCIONAL`
  - DM Sans Regular 400 uppercase, `#C89136` (gold), letter-spacing +0.06em, ~16px
- Número-âncora: `< 120`
  - DM Sans Light 300, `#C89136` (gold), ~160px
- Unidade: `mg/dL`
  - DM Sans Regular 400, `#f8fffc`, ~22px
- Caption sub: `Longevify`
  - Georgia Italic, `#557D6D`, ~14px

### FOOTER EDITORIAL (72–88% da altura)
Duas linhas em Georgia Italic, `#f8fffc`, ~20px, alinhamento center, leading 1.4.

```
A diferença entre as faixas não é estatística.
É o intervalo silencioso onde a glicação acontece.
```

### LOGO (88–100% da altura)
- Posição: bottom-center
- Width: 28% da largura total (~302px)
- Cor: `#f8fffc`
- Padding inferior: 5%

---

## 3. Cópia final on-image

```
[TOP BADGE]
FAIXA FUNCIONAL · 03

[BIOMARCADOR]
GLICOSE PÓS-PRANDIAL
medida 2 horas após a refeição

[TABELA · COLUNA ESQUERDA]
FAIXA LABORATÓRIO
< 140
mg/dL
referência ADA

[TABELA · COLUNA DIREITA]
FAIXA FUNCIONAL
< 120
mg/dL
Longevify

[FOOTER]
A diferença entre as faixas não é estatística.
É o intervalo silencioso onde a glicação acontece.

[LOGO]
Longevify
```

---

## 4. Caption (Instagram · cole-e-poste)

```
O número não mudou. A leitura mudou.

Jejum abaixo de 100 entra como normal no laudo.
Duas horas depois da refeição, abaixo de 140 também.

A faixa funcional é mais estreita: jejum entre 70 e 90,
pós-refeição abaixo de 120. O corredor entre as duas leituras
é onde a glicação acontece sem aparecer no exame.

Mesmo biomarcador. Outra precisão.
```

---

## 5. Alt text (acessibilidade)

```
Imagem vertical em fundo verde-floresta da Longevify. No topo, badge dourada com a inscrição "Faixa Funcional · 03". Abaixo, o nome do biomarcador "Glicose pós-prandial" e a nota "medida 2 horas após a refeição". No centro, duas colunas em paralelo: à esquerda, "Faixa Laboratório · menor que 140 mg/dL · referência ADA"; à direita, "Faixa Funcional · menor que 120 mg/dL · Longevify". Os números aparecem em destaque dourado. Abaixo, em itálico: "A diferença entre as faixas não é estatística. É o intervalo silencioso onde a glicação acontece". Logotipo Longevify centralizado na base.
```

---

## 6. Voz e restrições (self-check)

- [x] pt-BR puro, sem anglicismos não-clínicos
- [x] Sem self-help (zero verbos imperativos do tipo "transforme", "otimize", "domine")
- [x] Sem fear (sem "perigo", "risco silencioso ataca", "alarme")
- [x] Sem promessa de cura (zero "reverter", "eliminar", "garantir")
- [x] Sem persona-específica (sem idade, sem profissão, sem gênero)
- [x] Sem emoji
- [x] Sem hashtag
- [x] Termos clínicos preservados: glicose, glicação, pós-prandial, ADA
- [x] Tom Aesop poster (frase curta, peso editorial) + precisão Mito (números crus, sem decoração)

---

## 7. Hierarquia técnica e fontes implícitas

- Faixa de referência laboratorial: American Diabetes Association — glicose pós-prandial 2h < 140 mg/dL como limite superior do "normal".
- Faixa funcional: literatura de longevidade contemporânea (Function Health, Levels, Attia, Kraft) — pós-prandial < 120 mg/dL e jejum 70–90 mg/dL como faixas de preservação tecidual.
- Mecanismo citado no footer: glicação avançada (AGEs) ocorre de forma dose-dependente em exposições repetidas a picos > 140 mg/dL, mesmo na ausência de critério diagnóstico de diabetes ou pré-diabetes.

A peça não cita fontes on-image (mantém limpeza editorial). As fontes ficam no content object e em eventual carrossel de follow-up.

---

## 8. Score self-rubric (0–12)

| Critério | Nota | Justificativa |
|---|---|---|
| Hook strength | 2/2 | Paradoxo "número igual, leitura diferente" é memorável e postável |
| Pillar fit (biomarcador escondido) | 2/2 | Faixa funcional × laboratorial é o pilar 2 destilado |
| Series fit (FAIXA FUNCIONAL) | 2/2 | Estrutura idêntica à entrada 02 (ApoB) — série coerente |
| Voz (Mito + Aesop, sem deslizes) | 2/2 | Zero self-help, zero fear, zero persona, zero promessa |
| Densidade visual (single image) | 2/2 | Hierarquia clara: badge, biomarcador, tabela, footer, logo |
| Caption postável (4–6 linhas) | 1.5/2 | Cumpre o paradoxo, 6 linhas; poderia comprimir para 5 |
| **Total** | **11.5/12** | |

---

## 9. Próximos passos (handoff)

1. Designer renderiza 1080x1350 conforme especificação visual da seção 2.
2. Revisão de voz: confirmar que footer Georgia italic não estoura 2 linhas em renderização final.
3. Aprovação editorial.
4. Schedule no Buffer/Later para Sexta 22/mai 19h BRT.
5. State transition: `draft` → `approved` → `scheduled` → `published`.
