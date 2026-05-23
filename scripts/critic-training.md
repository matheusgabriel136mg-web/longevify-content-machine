# Critic Training — Padrões de ajuste extraídos das sessões Cortisol/Estresse + Ferritina

Documento de calibração. Cada linha: o que o critic DEVE detectar como issue ANTES do Matheus precisar dizer.

---

## Sessão Cortisol/Estresse (21/mai/2026) · ~60-80 inputs · resultado 7/10

| # | ANTES (rejeitado) | DEPOIS (aprovado) | Padrão detectável |
|---|---|---|---|
| 1 | Capa palette forest dark `#1C3F3A` sólido flat | Capa warm cream/taupe `#BBB4A2` com foto editorial Higgsfield | **H6 paleta proibida** ou **S10 bg flat** se cover sólido. |
| 2 | Logo branca na capa + logo dark nos slides internos | Logo branca em TODOS os slides do carrossel | **H1 logo cor inconsistente** |
| 3 | Logo escala 22% num slide, 28% noutro | Logo 25% LOCKED em todos | **H2 logo escala** (variação > 3%) |
| 4 | Headline serif Playfair-style | Inter Light 300 (line 1) + Georgia Italic (line 2) | **H8 fonte serif Playfair em display** |
| 5 | Sub "Aqui está como redefinir" (genérico self-help) | Sub "Crie um protocolo pra restaurar o ritmo" (oferta de produto) | **S5 copy sub genérica self-help** |
| 6 | Kicker "ESTRESSE · 01" no topo da capa | Sem kicker | **H5 kicker presente** |
| 7 | Texto cobrindo o rosto do subject sem gradient | Texto na metade bottom + gradient overlay bottom-up | **S8 texto cobre subject sem gradient** |
| 8 | Foto editorial com rosto humano detalhado | Metáfora visual: palitos queimados, vela, paisagem Rio na névoa | **H7 rosto humano detalhado** |
| 9 | Title position alto sobreposto à logo | Title centralizado, respira ≥150px acima da logo | **H3 texto sobrepondo logo** |
| 10 | Pill cards outline forest + texto forest (low contrast) | Outline branca + texto branco sobre warm taupe | **Contraste insuficiente** (criar S11) |
| 11 | Footer monospace "PROTOCOLO DE REEQUILÍBRIO" sem aprovação | Sem footer | **S9 footer monospace sem aprovação** |
| 12 | Vídeo: gráfico completo aparece de uma vez | Animação progressiva: linha desenha L→R, dot, body fade | **Reel não-progressivo** |

---

## Sessão Ferritina (21/mai/2026) · iterações dentro da sessão (auto-detectadas durante a build)

| # | ANTES (rejeitado) | DEPOIS (aprovado) | Padrão detectável |
|---|---|---|---|
| 1 | Cover S1 com bars cream-taupe laterais (Higgsfield com white margins não trimadas direito) | Cover full-bleed: `extract({left:200, top:50, width:1456, height:2204})` antes do cover-fit | **H4 crop bars laterais** |
| 2 | Cover S1: text no topo y=360 cobrindo o rosto blur | Text bottom-half y=880 com gradient overlay 0→55% bottom-up | **S8 texto cobre subject** |
| 3 | S3/S4: cardStartY=460 + cardGap=32 → última linha de body em y~1213, logo top em y~1225 → overlap | cardStartY=330 (subido 20%), cardGap=22 → última linha em y~1059 (160px gap da logo) | **H3 texto sobrepondo logo** |
| 4 | S3/S4: cards padX=70, divider edge-to-edge → conteúdo visualmente colado à esquerda | iconSize=130, group horizontalmente centralizado, divider só sob largura do bloco | **S3 bloco descentralizado** + **S6 divider edge-to-edge** |
| 5 | S5: startY=520 (190px dead space entre sub e primeiro item) + X marks tiny (xSize=70 sem círculo) | startY=330 (mesma cadência S3/S4), X dentro de círculo outline 130px (paridade com icons) | **S1 dead-space** + **S7 icon size inconsistente intra-carrossel** |
| 6 | S2: headY=200 (todos os outros em headY=110) | headY=130, normalizado | **S2 headline-Y inconsistente** |
| 7 | S2: chartY=380 → 180px dead space entre sub bottom e chart top | chartY=290 → ~100px respiro | **S1 dead-space** |

---

## REGRAS EMERGENTES (que o critic deve aprender)

### REGRA DE CONSISTÊNCIA INTRA-CARROSSEL (a mais importante)

Se headY varia > 30px entre slides do mesmo carrossel → fail.
Se iconSize varia > 10px entre slides do mesmo carrossel → fail.
Se padX (left margin do bloco) varia > 20px entre slides → fail.
Se logo width varia > 5% → fail.
Se logo cor difere → fail (sempre branca).

### REGRA DE GAP MÍNIMO ENTRE TEXTO E LOGO

```
last_content_y + line_height > logo_top_y  →  HARD FAIL H3
```

Em 1080x1350 design space: logo top ≈ 1225. Último conteúdo bottom < 1180 (deixar ≥45px respiro).

### REGRA DE DEAD-SPACE

```
gap(sub_bottom → first_content_top) > 120px  →  SOFT FAIL S1 (-2)
gap(sub_bottom → first_content_top) <  60px  →  SOFT FAIL apertado (-1)
ideal:  80-100px
```

### REGRA DE CENTRALIZAÇÃO HORIZONTAL DE BLOCO

```
bloco_center_x - canvas_center_x > 60px  →  SOFT FAIL S3 (-1)
```

Calcular: bloco = (icon_left + icon_width/2 + max_text_right) / 2. Comparar com W/2.

### REGRA DE CROP DE BG FOTOGRÁFICO

Se cover BG é foto Higgsfield → SEMPRE extract margin sides primeiro (cover-fit não remove faixas cream-taupe não-puras).

```
Detect: pixel sample da coluna leftmost == pixel sample da coluna 100px in → bars present
        OR pixel column variance < threshold em zonas de borda → faixa uniforme = fail
```

### REGRA DE TEXTO SOBRE SUBJECT

Se cover bg tem subject identificável (figura, blur portrait) E texto está sobre a região do subject:
- Sem gradient overlay → FAIL S8
- Com gradient overlay bottom-up ou top-down adequado → OK

---

## PADRÃO DE LOOP IDEAL (render → critic → fix)

```
render-X.mjs roda → produces slide-N.png * K

→ critic.mjs --run X
   ├─ slide-1: score 9/10, soft S5 fix_notes: "sub muito genérica, troca por oferta concreta"
   ├─ slide-2: score 7/10, soft S2 fix_notes: "headY=200, normalizar pra 110"
   ├─ slide-3: score 6/10, hard H3 fix_notes: "card 4 body line2 em y=1213, logo top y=1225. Subir cardStartY de 460 para 380"
   └─ AGGREGATE: 1 HARD + 2 SOFT → ITERATE

→ patch render-X.mjs (editar coords/copy conforme fix_notes)
→ re-render
→ re-critic
→ loop até all approved
→ show Matheus o set final
```

**Budget de iterações:** máximo 3 loops antes de pedir input humano. Se após 3 loops ainda failing, surface to Matheus.

---

## CALIBRAÇÃO RUN #1 (22/mai/2026) — false positives detectados

### Critic vs Realidade (slides ferritina aprovados por Matheus)

| Critic flag | Slide | Veredito | Razão |
|---|---|---|---|
| ❌ H7 rosto humano (cover) | slide-1 | **FALSE POSITIVE** | Blur olive moderado, profile cortado, contornos faciais NÃO nítidos. Matheus aprovou. Critic estava lendo "regra blur EXTREMO obrigatório" muito literal. → H7 amended pra "rejeitar SOMENTE se traços nítidos identificáveis". |
| ❌ H8 Georgia Italic display (cover, S3) | slide-1, slide-3 | **FALSE POSITIVE** | Padrão Inter Light L1 + Georgia Italic L2 é APPROVED Longevify (locked sessão Cortisol). Critic estava rejeitando o brand-standard. → H8 amended pra permitir 2-line pattern. |

### Critic vs Realidade — TRUE POSITIVES (issues reais que escaparam ao auto-audit)

| Critic flag | Slide | Veredito | Action |
|---|---|---|---|
| ⚠️ S7 icon size variation | slide-3 | **TRUE POSITIVE** | Círculo do card 1 (Névoa mental, icon-brain) parece maior. Confirmar dimensões reais e normalizar. |
| ⚠️ S1 dead space ~240px (estimado) | slide-3 | **PARTIAL TRUE** | Atual ~120px (já fixei subindo cardStartY 410→330). Critic talvez estimou mais por ler do JPEG downsized. |
| ⚠️ S5 sub genérica "Investigue além do hemograma básico" | slide-1 | **TRUE POSITIVE** | Sub poderia ofertar protocolo mais concreto ("Peça o painel completo. Não só hemoglobina."). |
| ⚠️ S8 gradient overlay insuficiente | slide-1 | **PROBABLY TRUE** | Pode aprofundar o gradient pra 60% bottom. |

### Lição da calibração

Cada false positive ⇒ regra amendada + training pair adicionada.
Cada true positive ⇒ regra confirmada + slide deve ser iterado.

Próxima run (após amendamentos): esperado todos slides aprovarem com 8+/10 ou critic apontar SÓ issues reais novas.

---

## CALIBRAÇÃO RUN #2 (22/mai/2026 tarde) — Julia persona carrossel

### True positives importantes
- **S3 status vermelho saturado** = TRUE POSITIVE H6 paleta. Crítico catch. Tons saturados rejeitados, troca por warm amber dessaturado #C89136 ou muted terracotta.
- **S6 "LINK NA BIO"** = TRUE POSITIVE H10 CTA clichê. Removido. Fechamento editorial italic é mais Longevify.

### False positives a documentar
- **S4 "biologia da Julia" flagged como H11** = FALSE POSITIVE. H11 era sobre "texto inglês em copy não-técnica", crítico generalizou pra "persona-específica que exclui leitor" (que é regra CLAUDE.md mas DIFERENTE de H11).
  → Caso especial: posts persona-case-study (Conheça a Julia, Conheça o Pedro etc) PRECISAM da persona nomeada. É um pattern Longevify approved (OVERHEARD/persona-bio). H11 só deve flag inglês, não persona.
  → Crítico precisa aprender o pattern: se cover diz "CONHEÇA A X", os internals podem referenciar X normalmente.

### Padrão aprendido
**Persona-case-study é um pattern válido Longevify.** Cover apresenta a persona ("CONHEÇA A JULIA"), internals contam a história dela (sintomas, biomarcadores, protocolo, resultado, manifesto). Crítico não deve hard-fail H11 nesses casos.

---

## CALIBRAÇÃO RUN #3 (22/mai/2026 noite) — Julia internals dark palette

### REGRA EMERGENTE CRÍTICA: palette derivada da cover, NÃO default fixo

Matheus rejeitou WARM TAUPE como default universal: "n é para ficar repetindo esse marrom toda hora cara". Internal slides de cada post devem extrair palette da cover daquele post:

| Post | Cover aesthetic | Internal palette aprovada |
|---|---|---|
| Ferritina | Blur olive editorial | Warm taupe #BBB4A2 (matches blur warmth) |
| Cortisol/Estresse | Palitos queimados warm | Warm taupe + (warm cream) |
| Julia persona | Sauna cedar wood + dark biomarker glass cards | **Dark charcoal warm #1A1916** com amber accent #D4A053 |
| Jockey manifesto | Clay terra + white tank + olive trees | (a definir — provavelmente cream/off-white com terra accent) |

### Critic false positive: H6 paleta proibida em Julia dark

Critic flag: "preto puro fora da paleta Longevify". 
Realidade: bg #1A1916 é cedar-warm dark derivado da capa Julia (sauna wood + biomarker overlay cards). Matheus APROVOU explicitamente.

→ Regra amendar: H6 não deve flag dark warm (#1A1916, #2A1F18, #1C3F3A com textura) quando a cover do post estabelece um mundo dark/clinical/cedar. A regra warm taupe é DEFAULT pra posts cuja cover é warm; não universal.

### Heurística pra próxima iteração

```
input: slide-1 cover.png (Matheus-approved external) + slide-N internal candidato
1. extrair palette dominante da cover (3-5 cores)
2. internal slide bg deve estar dentro da família dessa palette
3. se internal está em palette diferente da cover → flag S12 (palette inconsistente intra-carrossel)
4. se internal está em palette aprovada PARA AQUELE POST → ship
```

H6 (paleta proibida) deve marcar apenas: vermelho saturado, âmbar saturado puro, laranja, white puro #FFFFFF, sépia warm golden hour saturado, qualquer rosa. NÃO marcar dark warm derivado de cover.
