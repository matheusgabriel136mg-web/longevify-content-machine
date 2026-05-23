# 🚨 CRITICAL DRIFT FLAGS — 2026-05-23

> Detectado pelo Cross-Version Diarization (read-only) overnight.
> Brief completo em `runs/_briefs/cross-version-2026-05-23.md`.

---

## ✅ ~~BLOCKER #1~~ — RESOLVED (CEO project commit 2026-05-23 noite)

Matheus patcheou Brand CC manualmente. LONGEVIFY_BRAND.md agora v2.0 alinhado.

---

## 🔴 (ORIGINAL) BLOCKER #1 — Brand CC desatualizada (pre-v2.0)

**Arquivo:** `/Users/mathe/Documents/Longev/Brand CC/LONGEVIFY_BRAND.md`

**Gap específico:**
- Declara público "30-55 anos" → brand-truth.md v2.0 diz "30-50 com corte 51+ não é ICP" (diferença de 5 anos)
- ZERO menção às 4 personas (Maria/Julia/Pedro-Carlos/Ana)
- Posicionamento diferente: "Medicina de precisão para o Brasil. Health-tech de longevidade..." vs brand-truth canonical "A inteligência integrada da sua saúde..."

**Por que é CRÍTICO (não só importante):**
- Se Brand CC é input de OUTROS agents externos (design briefings, copy de site, etc.), eles estão produzindo material pré-v2.0 sem rastreabilidade
- Cada peça externa gerada com a versão errada amplifica o drift
- Não está na minha alçada — você (CEO project) precisa decidir patch ou eu tocar

**Ação proposta (você decide):**
- (a) Edito Brand CC eu mesmo agora amanhã (overnight não — toquei "Não modifica arquivo do CEO project" mas Brand CC é zona cinza)
- (b) Você toca patch manual no Brand CC amanhã
- (c) Ignora — Brand CC vira deprecated e content-machine + CEO bastam

---

## 🟡 BLOCKER #2 — Persona attribution: 76% dos runs "unknown"

CLAUDE.md regra: "cada peça serve hero ICP via UMA das 4 personas — peça que não cabe = REJECT".
Realidade: 16/21 runs (76%) têm `persona: unknown`. Regra existe, não está sendo aplicada.

**Fix sugerido:**
- Validation no script de criação de run: persona = enum restrito {maria, julia, pedro, ana, todas} (todas = só pra P1)
- Editor-agent JÁ FAZ persona detection (det + LLM tiebreak). Pipeline pode usar isso pra auto-popular o campo no content-object antes de "verified".

---

## 🟡 BLOCKER #3 — P5 (Integrador) em produção-ZERO

P5 = "O Integrador" = pilar que materializa o posicionamento central do produto ("substituir 5-15 profissionais soltos").
Mix target: 1/12 = 8%. Realidade: 0/21 runs.

**Implicação:** o argumento de venda central do Longevify nunca foi instrumentalizado em conteúdo. Audience nunca foi exposta à racionalização $R$130 vs R$1.500-4.000.

**Fix sugerido:** próximo carrossel deve ser P5 (Integrador). Briefing já tem material em foundation/pillars.md.

---

## 🟡 BLOCKER #4 — Ana (executiva premium 40-55) em produção-ZERO

Persona Ana = 0/21 runs (0%). Voice mode "biomarcador deep-dive sofisticado" nunca testado.

**Fix sugerido:** próximo carrossel P2 ou P4 deve mirar Ana explicitamente. Hook: "ApoB > LDL", "Lp(a) hereditário", "telômero" — vocabulário Ana-strong.

---

## Resumo executivo

**Drift de docs:** 1 (Brand CC pre-v2.0)
**Drift operacional:** 3 (persona unknown 76%, P5 zero, Ana zero)
**Severidade combinada:** ALTA — multi-persona declarada não está sendo executada NEM nos docs externos NEM na produção.

**Ação imediata recomendada:** decisão sobre #1 (Brand CC patch) + enforcement persona (#2) bloqueiam os outros gaps.
