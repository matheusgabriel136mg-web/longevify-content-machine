# Cross-Version Diarization · 2026-05-23

> Read-only diarization (Tan principle #5). Auto-gerado pelo content-machine.
> Custo: $0.0634 · Tempo: 52.7s

---

# Cross-Version Diarization Brief — Longevify
**Gerado por**: Cross-Version Diarization Agent
**Data**: 2026-05-28
**Runs analisados**: 21 | **Publicados**: 3 | **Verified**: 7 | **Draft/Idea**: 11

---

## 1. Versão dominante em DOCS estratégicos

**v2.0 multi-persona horizontal** — consolidada em 2026-05-17 e replicada consistentemente em todos os docs declarativos analisados.

| Doc | Versão declarada | Alinhamento com brand-truth.md |
|---|---|---|
| `brand-truth.md` | v2.0 — SOURCE OF TRUTH | ✅ Referência canônica |
| `icp.md` | v2.0 — multi-persona 4 personas | ✅ Alinhado |
| `modelo-de-negocio.md` | v2.0 — 3 tiers + ICP unificado | ✅ Alinhado |
| `LONGEVIFY_BRAND.md` (Brand CC) | Não numera versão, mas descreve público 30-55 anos | ⚠️ Divergência menor (ver §3) |
| `foundation/strategy.md` | v2.0 — explicitamente "substitui versão atleta 18-60" | ✅ Alinhado |
| `foundation/voice.md` | v2.0 — 4 modes, substitui mono-mode anterior | ✅ Alinhado |

**Conclusão doc**: hierarquia de override está operacional (`brand-truth.md` vence) e uniformemente declarada nos headers dos docs subordinados.

---

## 2. Versão dominante em PRODUÇÃO (baseado em runs)

**Distribuição real nos 21 runs:**

| Dimensão | Declared (brand-truth.md) | Operational (runs/) | Gap |
|---|---|---|---|
| **Pillar dominante** | P2: 3/12 (25%) | P2: 15/21 (71%) | **+46pp** |
| **Pillar P4** | P4: 3/12 (25%) | P4: 1/21 (5%) | **−20pp** |
| **Pillar P3** | P3: 2/12 (17%) | P3: 2/21 (10%) | −7pp |
| **Pillar P5** | P5: 1/12 (8%) | P5: 0/21 (0%) | **−8pp** |
| **Pillar P6** | P6: 1/12 (8%) | P6: 1/21 (5%) | −3pp |
| **Pillar P1** | P1: 2/12 (17%) | P1: 2/21 (10%) | −7pp |
| **Persona "unknown"** | 0% esperado | 16/21 (76%) | **+76pp** |
| **Persona Julia** | 25% do mix (1 de 4) | 1/21 (5%) | −20pp |
| **Persona Ana** | 25% do mix (1 de 4) | 0/21 (0%) | **−25pp** |
| **Persona Pedro/Carlos** | 25% do mix (1 de 4) | 1/21 (5%) | −20pp |
| **Format carousel** | Não prescrito em %  | 14/21 (67%) | — |

**Versão operacional de facto**: produto de biomarcador-educacional mono-pilar, persona não atribuída. A v2.0 multi-persona NÃO se reflete na produção.

---

## 3. Conflitos detectados entre fontes

1. **Brand CC vs brand-truth.md — faixa etária do público**: `LONGEVIFY_BRAND.md` declara "30-55 anos"; `brand-truth.md` e `icp.md` declaram "30-50 anos" com corte explícito "51+ não é ICP". Conflito de 5 anos no teto do público-alvo. Brand CC predateia a decisão de 2026-05-17 e não foi atualizado.

2. **Brand CC vs brand-truth.md — ausência de estrutura de personas**: `LONGEVIFY_BRAND.md` descreve público como bloco monolítico ("Profissionais brasileiros de alta renda, 30-55 anos") sem mencionar as 4 personas de copy (Maria/Julia/Pedro-Carlos/Ana). Pré-v2.0 ainda operacional no Brand CC.

3. **Brand CC vs brand-truth.md — frase de posicionamento**: `LONGEVIFY_BRAND.md` usa "Medicina de precisão para o Brasil. Health-tech de longevidade que transforma dados biológicos em ação concreta." `brand-truth.md` define como canonical: "A inteligência integrada da sua saúde. Seus exames, seu wearable e seu acompanhamento médico finalmente conversando — para quem já cuida, mas sente que os dados estão soltos." Frases distintas, propósito semântico distinto (posicionamento técnico-científico vs posicionamento de integração/frustração).

4. **CLAUDE.md vs operacional — atribuição de persona nos runs**: `CLAUDE.md` declara "cada peça serve hero ICP via UMA das 4 personas reconhecidas — peça que não cabe em nenhuma = REJECT". 16/21 runs (76%) têm `persona: unknown`. A regra de REJECT está sendo sistematicamente não aplicada.

5. **foundation/strategy.md vs operacional — pricing ausente nos runs**: Nenhum run dos 21 menciona tier ou CTA de pricing. Não é conflito de doc vs doc, mas sinal de que o diferenciador de acessibilidade (R$130/mês vs R$1.500-4.000 fragmentado) não está sendo instrumentalizado em conteúdo.

---

## 4. Drift declared vs operational

**Pillar mix drift**:
O mix declarado distribui P2 como 25% do volume (3/12 posts). Na prática, P2 representa 71% da produção. Longevify está produzindo, de facto, um canal de educação sobre biomarcadores — não um canal multi-pilar. P4 ("Da Sensação ao Dado"), que é descrito como "pilar-âncora do diferenciador" em `strategy.md`, representa apenas 5% dos runs. P5 ("O Integrador") — o pilar que materializa o posicionamento central do produto — tem zero runs.

**Persona mix drift**:
4 personas declaradas com peso horizontal equivalente. Na prática: 76% dos runs não têm persona atribuída, Ana tem 0% de presença, Pedro/Carlos e Julia têm 1 run cada. Maria tem 1 run explícito + 1 combinado (maria-ana). A produção está operando como se a decisão multi-persona de 2026-05-17 não tivesse ocorrido.

**Voice tone drift**:
Não mensurável diretamente via metadados, mas inferível: com 71% P2 e 76% persona unknown, os 4 voice modes declarados (frustração validada / persona-bio warm / athletic premium / biomarcador deep-dive) não estão sendo diferenciados por peça. A produção converge para um único mode implícito: biomarcador-educacional neutro.

---

## 5. Recomendações de sync (ordem de prioridade)

**1. Patch imediato: Brand CC — atualizar `LONGEVIFY_BRAND.md`**
Adicionar header de versionamento com referência à decisão 2026-05-17. Corrigir faixa etária de "30-55" para "30-50". Inserir tabela das 4 personas. Substituir frase de posicionamento pela canonical de `brand-truth.md`. Responsável: quem mantém Brand CC. Prazo sugerido: antes do próximo ciclo de produção.

**2. Enforcement de persona obrigatória nos runs**
Implementar validação no pipeline de criação: campo `persona` não pode receber `unknown` em runs que saiam de `idea` para `draft`. Opções: (a) lint no script de criação de run que rejeite `unknown`; (b) template de run com `persona` como enum restrito às 4 opções + "todas" apenas para P1. A regra já existe em `CLAUDE.md` — o gap é de enforcement, não de declaração.

**3. Rebalancear pillar mix nos próximos 2 ciclos**
Com base na distribuição atual (P2 em 71%), os próximos 8 runs devem priorizar: 3× P4, 2× P5, 1× P3, 1× P6, 1× P1. Isso não zera o drift mas move a média em direção ao mix declarado sem ruptura brusca. P5 especificamente ("O Integrador") precisa de ao menos 1 peça publicada — atualmente está em produção-zero apesar de ser o pilar que materializa o posicionamento central.

**4. Produzir 1 run por persona ausente (Ana, Pedro/Carlos) nos próximos 14 dias**
Ana tem 0 runs. Pedro/Carlos tem 1 run (P6/reel). Ambas as personas têm voice mode e pilar mapeados. Sugestão mínima: 1 carousel P2 ou P4 para Ana (biomarcador deep-dive) + 1 carousel P4 para Pedro/Carlos (integração HRV/wearable). Objetivo: validar se o voice mode diferenciado funciona na prática antes de escalar.

**5. Auditar o Brand CC como dependência de agentes externos**
Se `LONGEVIFY_BRAND.md` é insumo de outros agentes ou briefings de design/copy fora do content-machine, o conflito de posicionamento (frase canônica diferente + personas ausentes) pode estar gerando outputs fora da v2.0 sem rastreabilidade. Mapear quais workflows consomem Brand CC diretamente.

---

## 6. Saúde geral

⚠️ Docs estratégicos estão alinhados em v2.0 exceto Brand CC (pré-v2.0 ativo); produção operou em v1.x implícita nos últimos 21 runs — decisão multi-persona de 2026-05-17 está declarada mas não executada.