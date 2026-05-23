# Cover Brand Rule

> Última refinement: 2026-05-23 (founder course-correction depois do labeling rodada 1).

## Regra atualizada

**Capa = imagem editorial com cena ou objeto fotográfico em contexto premium brasileiro.**

NÃO é "foto de cara/face obrigatória". É qualquer um destes:

✅ **Pode ser:**
1. **Pessoa** (corpo, mãos, cara) em contexto premium BR (varanda, café, escritório, lagoa, sauna, calçadão)
2. **Cena** (mesa de café, sauna cedar, varanda Rio, praia, mesa restaurante SP, escritório warm)
3. **Objeto em contexto premium** (cápsula sobre mármore + luz natural, wearable no pulso com pele, exame em papel premium, glicosímetro sobre madeira)
4. **Paisagem brasileira premium** (Lagoa Rodrigo de Freitas na névoa, calçadão pedras portuguesas, montanhas RJ ao amanhecer, mata atlântica filtrada)

❌ **Não pode:**
1. Cor sólida (forest/dark/cream) + texto/número grande sozinho
2. Black background + número gold sem cena
3. Verde + quote sem foto
4. Qualquer composição onde **>65% da área central** é uma única cor flat

## Por quê

Função da capa: parar o scroll. Texto sobre cor lisa parece slide de power-point — perde no feed contra Function/Mito/SP que usam composição fotográfica + texto editorial overlay.

Texto/dado em overlay é fine — desde que a imagem-base seja editorial premium.

## Check deterministic

`scripts/agents/cover-validator.mjs` analisa pixel variance + dominância modal:

| lum_std | solid_pct | verdict |
|---:|---:|---|
| < 18 | > 65% | ❌ FAIL — solid color dominant |
| < 28 | > 75% | ⚠️ WARN — low photographic content |
| else | else | ✅ PASS |

**Zona excluída do sample:** top 12% + bottom 12% (text overlay + logo zones). Centro 76% = onde a imagem editorial precisa estar.

Calibração (2026-05-23, sample 4 covers):
- vit-d-brasil-dado: lum_std 17.9, solid 92% → FAIL ✓
- overheard-apob: lum_std 14.6, solid 91% → FAIL ✓
- julia-persona (control good): lum_std 38.3, solid 34% → PASS ✓

## Como usar

**Antes de aprovar qualquer cover novo:**
```bash
node scripts/agents/cover-validator.mjs --run <run-id>
```
Exit 0 = pass/warn (revisar visual). Exit 1 = fail (regenerar com cena).

**Pode ser wireado no editor stage 1** futuro: bloqueia approving se cover falha o validator.

## Prompt template para regeneração

Quando regenerar cover via Higgsfield, use este shape:

```
Editorial cinematic [close-up macro | wide cinematic | medium portrait]
photograph, 4:5 vertical. [PESSOA/OBJETO/CENA] in [CONTEXTO BRASILEIRO PREMIUM].
Color grade: [deep forest green + warm amber | dark cedar warm | cream taupe with gold accent].
Premium [Vogue Brasil | Wallpaper | Cabana magazine] editorial aesthetic.
Generous negative space [upper third | lower third | center] for text overlay.
Medium format, shallow depth of field, slight film grain.

ABSOLUTELY NO text, logos, watermarks, white background, pastel colors,
cliche stock, AI-tell artifacts (extra fingers, melting features),
heavy saturation, golden hour over-exposure.
```

Sample variables:
- **PESSOA**: "woman 35-45 with hands on coffee mug", "executive 40s reading paper"
- **OBJETO**: "vitamin capsule on marble countertop", "Garmin watch on toned forearm", "glucose meter on rustic wooden table"
- **CENA**: "morning coffee scene on Lagoa varanda", "sauna cedar interior with steam light", "Brazilian restaurant table mid-afternoon"
- **CONTEXTO BR**: "premium Rio apartment with Lagoa view", "São Paulo Jardins café", "Higienópolis apartment morning light", "Ipanema calçadão at dawn"

## Histórico

- 2026-05-21 (initial): regra era "foto de pessoa em contexto premium" — interpretado restritivamente como "obrigatório rosto humano"
- 2026-05-23 (this refinement): generalizado pra cena/objeto/pessoa. Adicionado check deterministic.
