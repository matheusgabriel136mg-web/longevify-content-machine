# Longevify Visual Critic Rubric

Régua de avaliação aplicada a CADA slide antes do agente mostrar ao Matheus.
Compilada a partir de CLAUDE.md + feedback.json + emergent rules da sessão Cortisol/Estresse + Ferritina (mai/2026).

---

## HARD FAILS (score 0 automático · iteration obrigatória)

| Código | Regra | Como detectar visualmente |
|---|---|---|
| H1 | Logo cor inconsistente no carrossel | Se algum slide tem logo branca e outro logo dark/preta, hard fail. Default sempre BRANCA. |
| H2 | Logo escala inconsistente | Logo width != ~25% do canvas. Padding bottom 4-7% canvas. Variação > 5% = fail. |
| H3 | Texto sobrepondo logo | Última linha de texto/elemento bottom Y >= logo top Y. |
| H4 | Crop bars laterais no cover | Faixas brancas ou cream-taupe lisas visíveis na esquerda/direita/top/bottom da foto bg. |
| H5 | Kicker tipo "ESTRESSE · 01" ou "FERRO · 02" na cover | SP/Mito não usam. Hard fail. |
| H6 | Paleta proibida | Vermelho saturado, âmbar puro, laranja saturado, white puro #FFFFFF, sépia warm golden hour saturado, qualquer rosa/magenta. |
| H7 | Rosto humano DETALHADO/NÍTIDO em foto editorial cover | Risco AI uncanny valley. Aceito: blur moderado a extremo, profile cortado, subject de costas, blur dreamy onde contornos faciais NÃO são identificáveis com nitidez (pode haver silhueta/hair visíveis em blur soft). **REJEITAR somente se traços faciais nítidos / olhos focados / pele com textura detalhada.** Blur olive dreamy estilo Mito Iron Cover = OK. |
| H8 | Fonte Playfair em headline display | Inter only para fonte principal. **EXCEÇÃO APPROVED pattern Longevify (NÃO FLAGGAR):** headline 2-linhas no padrão Inter Light L1 + Georgia Italic L2 é o LOCK do brand. Esse padrão aparece em: capa Estresse, capa Ferritina, slides internos card-list, etc. **Se você ver uma linha de display em itálica serif, NÃO assuma Playfair — assuma Georgia.** A diferença Playfair vs Georgia é difícil em renderização baixa resolução. Hard fail SOMENTE se TODAS as linhas em serif (sem Inter L1) OU se serifas claramente exibirem alto contraste ornamental ducal extremo (Didone-style). Quando em dúvida = NÃO flag H8. Prefira mencionar como observation no issues_detail. |
| H9 | Card retangular fundo branco em slide interno | Plota elementos direto no bg taupe. Sem cards brancos retangulares. |
| H10 | Hashtag, emoji (exceto 🇧🇷/❄️ contextual raro), ou CTA imperativo "clique aqui" no visual | Linha editorial Longevify zero clichê. |
| H11 | Texto inglês em copy não-técnica | pt-BR puro. Inglês só pra termos consagrados (hs-CRP, ApoB, ferritin = aceita ferritina). |

## SOFT FAILS (deduzir 1-3 pontos cada)

| Código | Regra | Tolerância |
|---|---|---|
| S1 | Dead space > 120px entre sub e primeiro elemento de conteúdo | Esperado: 60-100px |
| S2 | Headline-Y inconsistente entre slides do MESMO carrossel | Variação > 30px = -2 |
| S3 | Bloco de cards descentralizado horizontalmente | Offset > 60px do center canvas = -1 |
| S4 | Body text com line-height apertado (<1.3) ou estourado (>1.6) | -1 |
| S5 | Copy sub genérica "self-help" ("encontre seu equilíbrio", "viva melhor") | -2. Sub deve oferecer produto/protocolo concreto. |
| S6 | Divider edge-to-edge no card-list (vai de margem a margem do canvas) | -1. Divider deve ficar SOMENTE sob a largura do bloco. |
| S7 | Icons com tamanhos diferentes entre slides do mesmo carrossel | -1 |
| S8 | Composição cover com texto cobrindo o subject (rosto/figura) sem gradient | -2. Gradient overlay obrigatório se texto cobre subject. |
| S9 | Footer monospace "PROTOCOLO DE X" presente sem aprovação explícita | -1. Default = sem footer. |
| S10 | Slide interno bg cor sólido flat (forest dark #1C3F3A sem textura) | -1. Warm taupe #BBB4A2 é o default. Forest só se Matheus pedir + textura. |

## SLIDE-TYPE EXPECTATIONS

### Cover (S1 sempre)
- Headline grande centralizada, max 6 palavras, paradoxo/silêncio biológico
- Sub menor centralizada abaixo, oferece protocolo/produto
- Logo bottom-center 25% width LOCKED, branca
- SEM kicker
- Foto editorial Higgsfield warm/olive, blur dreamy, OBJETO > pessoa
- Texto não cobre subject (use gradient overlay se necessário)
- Composição quote estilo SP/Function/Mito

### Internal stat/chart (e.g. "Ferro ≠ Ferritina")
- Headline + sub no topo Y ≈ 110-160
- Visual central (chart, comparação, número grande)
- Italic editorial Georgia opcional no fechamento
- Logo bottom

### Internal card-list (3-4 items com icon + título + body)
- Headline + sub topo Y ≈ 110
- Cards centralizados horizontalmente (bloco icon+texto centralizado)
- Divider entre cards subtle (opacity 0.18-0.22) — só sob a largura do bloco
- Icons circulares fotográficos OU outlined com X (consistência intra-carrossel)
- Logo bottom

### Internal X-mark (3 itens "bloqueadores" / "evite isto")
- Headline + sub topo
- 3 items com X dentro de círculo outline (paridade visual com icon cards do mesmo carrossel)
- Logo bottom

### Reel/video
- Animação progressiva (left→right, fade-in escalonado)
- 1080x1920 portrait (IG reel)
- Sem texto estourando frame
- Logo no último frame ou bottom fixo

## SCORING SCALE

| Score | Estado |
|---|---|
| 10 | Pristine. Zero issues. Pronto pra publicar. |
| 9 | Excelente. 1 soft fail minor. |
| 8 | Ótimo. 1-2 soft fails minor. Threshold mínimo pra approve. |
| 7 | Aceitável mas iteration recomendada. 3 soft fails OU 1 soft major (-2 ou -3). |
| 6 | Iteration obrigatória. Múltiplos soft fails. |
| < 6 | Hard fail detectado OU 5+ soft fails. Refaz from scratch. |

**Regra de approval:** `approved=true` SOMENTE se score >= 8 AND zero hard_fails AND consistência com slides anteriores do mesmo carrossel.

## CONSISTÊNCIA INTRA-CARROSSEL

Quando avalia slide N de um carrossel, comparar contra slides 1 a N-1 já approveds:
- Logo cor IGUAL nos N slides
- Logo escala IGUAL (variação < 3%)
- Paleta BG dentro da mesma família (warm taupe #A29B89 → #D8D2C5)
- Headline-Y dentro de 30px de variação
- Mesmo padding lateral
- Tipografia idêntica (Inter Light / Regular, Georgia italic mesmo uso)
