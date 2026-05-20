# Idea Gate — Routing logic between Foundation and Writer

> A camada que decide o que vira run e qual rota toma. Não precisa Claude API — é regra estática + heurística que você (ou um script futuro) aplica antes de abrir uma run folder.
>
> **Inputs:** entries em `stores/inbox.md` + `stores/ideas.md`
> **Outputs:** decisão de rota → cria run folder em `runs/YYYY-MM-DD-NNN-slug/` com `content-object.md` + `idea.md` preenchidos
> **Status:** estático em Phase 1 (manual). Vira automatizado em Phase 2 (Idea Gate + Writer com Claude API).

---

## As 4 rotas

### 1. ORIGINAL (no external source)
**Definição:** Insight nativo, da sua cabeça, do segundo cérebro pessoal, de observação direta. Sem post de referência. Sem texto externo.

**Quando usar:**
- Você teve uma sacada original sobre biomarker/treino/longevidade
- Conversa real com cliente/atleta revelou dor não-catalogada
- Estudo recente que você leu (peer-reviewed) ainda não virou conteúdo em lugar nenhum
- Dado novo do produto Longevify (feature/insight do dashboard)
- Insight cultural BR não-coberto por SP/Mito/Function/Huberman

**Inputs típicos:**
- Brain dump em `stores/inbox.md`
- Voz memo transcrita (Phase 5 — Internal Knowledge Graph)
- Notas pessoais
- Observação direta (atleta, cliente)
- Paper recente

**Output esperado:** post que ninguém mais publicou. Maior diferenciação, maior risco.

**Pilares mais comuns:** 3 (Obsolescência), 5 (Integrador), 6 (Cultura)

**Quality bar:**
- O insight é genuíno ou é remix inconsciente?
- Resiste ao teste "consigo amarrar em dado concreto?"
- Tem virada interessante ou é só "fato"?

---

### 2. REPURPOSE (extend own content)
**Definição:** Pegar conteúdo que JÁ publicamos e dar nova vida. Format swap, ângulo diferente, novo público. Spine permanece nosso.

**Quando usar:**
- Carrossel high-performing → vira reel
- Reel high-performing → vira story-set didático
- Hero piece → vira manifesto post variante
- Post em texto → vira frame-set visual
- Conteúdo de 6+ meses → ressuscita para audiência nova
- Feature lançada → re-introduz com novo ângulo (3 meses depois)

**Inputs típicos:**
- `stores/winners.md` (winners que merecem extensão)
- Post antigo que você acha que merece reaproveitamento
- Feature do produto que precisa lembrança periódica

**Output esperado:** post que beneficia de equity já construído. Risco baixo, ROI conhecido.

**Pilares mais comuns:** 1 (Identidade — lançamentos retomados), 4 (Sensação→AI — UI re-explored)

**Quality bar:**
- O post original ainda é relevante / não está obsoleto?
- O novo formato traz algo, ou é só copy-paste?
- Audiência mudou o suficiente pra justificar?

**Regra:** repurpose só de wins ≥ 1.5x vsMedian. Não repurpose loser — re-imagina.

---

### 3. REWRITE (external src through voice)
**Definição:** Hook ou ângulo de fonte externa (SP, Mito, Function, Huberman, BetterBe, Seed) traduzido pra voz Longevify + adaptado pro ICP atleta BR. Mantém a estrutura ou insight da fonte, refaz pra falar com nosso público.

**Quando usar:**
- Hook forte em conta da watchlist
- Format inovador que vale adaptar
- Dado científico que SP/Mito publicaram bem
- Padrão visual proprietário que dá pra reinterpretar

**Inputs típicos:**
- `dashboard-data.json` (posts scrapados)
- Watchlist Tier 1/2 (SP, Mito, BetterBe, Function, Huberman, Seed)
- Screenshot manual de post chamativo

**Output esperado:** versão Longevify do hook/format. Mais segura que ORIGINAL, mais transformadora que REPURPOSE.

**Pilares mais comuns:** 2 (Biomarcador), 4 (Sensação→AI), 3 (Obsolescência) — onde SP/Mito dominam

**Quality bar:**
- A versão Longevify é claramente diferente da fonte (linguagem, ICP, paleta, voz)?
- Mantemos o que faz o hook funcionar (curiosity gap, paradoxo, etc.)
- Não é tradução literal (sem isso vira plágio)
- Atribuição quando necessário (se citarmos um estudo, link/cred)

**Anti-padrões:**
- Copiar SP/Mito com paleta trocada (visual plágio)
- Traduzir headline EN literal pra PT (sotaque errado)
- Adaptar sem reinterpretação cultural

---

### 4. RESEARCH + IDEATE (no post output)
**Definição:** Exploração que NÃO vira post imediato. Gera angles, alimenta `stores/ideas.md`, enriquece `stores/proof-bank.md`, prepara terreno pra futuros runs.

**Quando usar:**
- Tema novo precisa ser entendido antes de virar conteúdo (ex: novo biomarker, nova diretriz SBC)
- Padrão emergente na watchlist precisa ser dissecado
- Concorrente novo (ex: BetterBe) precisa análise profunda
- Você quer entender por que algo funcionou ou flopou — pré-iteração

**Inputs típicos:**
- Paper science recente
- Cluster de posts de SP/Mito num tema específico
- Trend emergente (HRV, Zone 2, Glucose monitoring, Methylene Blue)
- Análise pós-mortem de loser nosso

**Output esperado:** entries em `stores/ideas.md` (3-5 angles) + entry em `stores/proof-bank.md` (se rendeu dado citável). **NÃO** vira run de conteúdo imediato.

**Pilares afetados:** todos potencialmente — research alimenta o pipeline upstream.

**Quality bar:**
- Você fechou 3-5 angles testáveis em runs futuros?
- Você capturou dados/estudos citáveis em `proof-bank.md`?
- Você documentou no `feedback-log.md` ou em notas internas o que aprendeu?

**Quando research vira posts:** depois de 1-3 ideias do tema serem promovidas como REWRITE/ORIGINAL em runs.

---

## Decision tree (passos)

```
1. Olha o item em stores/inbox.md ou ideas.md
   ↓
2. Pergunta: tem fonte externa (SP, Mito, etc.) atrelada?
   ├─ SIM → próximo passo
   └─ NÃO → ORIGINAL (insight nativo) ou RESEARCH (se ainda precisa entender melhor)

3. Pergunta: pegamos a fonte como referência DIRETA pra um post agora?
   ├─ SIM → REWRITE
   └─ NÃO, ainda precisa estudar/comparar mais → RESEARCH

4. Pergunta: estamos retomando algo NOSSO já publicado?
   ├─ SIM → REPURPOSE
   └─ NÃO → uma das 3 acima
```

Caso de borda: fonte externa + insight nosso combinado → tipicamente vira ORIGINAL com referência creditada (não REWRITE).

---

## Critérios de promoção (de inbox → ideas → run)

**Inbox → Ideas (filtragem):**
- Pilar fit claro? (1-6)
- ICP fit? (atleta/wellness 18-60)
- Quality bar do hook (>6/10 gut feel)?
- Não duplica algo recente?

→ Se sim em todos: promove pra `stores/ideas.md` com priority (alta/média/baixa).

**Ideas → Run (decisão de rota):**
- Cadence do mês permite mais um post desse pilar?
- Effort vs reward favorável (research-heavy vs quick-win)?
- Há outro item de pilar carente pra balancear o mix mensal?

→ Se sim: cria run folder com rota decidida.

---

## Routing por sinal (tabela canônica — espelho do `pillars.md`)

| Sinal externo / interno | Pilar provável | Route |
|---|---|---|
| SP "Introducing X" / launch announcement | 1 (Identidade) | REWRITE |
| SP hero piece (System Warning, Cortisol post) | 1.2 ou 4 | REPURPOSE-do-conceito ou REWRITE |
| Mito hook biomarcador | 2 (Biomarcador) | REWRITE |
| Function emoção → biologia | 1, 4 ou 6 | REWRITE |
| Whoop/Oura post sobre HRV | 4 (Sensação→AI) | REWRITE |
| Conversa em Strava sobre fadiga | 2 ou 4 | ORIGINAL |
| Crítica geral ao plano de saúde | 3 (Obsolescência) | REWRITE |
| Atleta brasileiro inspirador | 6 (Cultura) | ORIGINAL |
| Análise "15 profissionais" / custo | 5 (Integrador) | ORIGINAL |
| Estudo SBC recém-publicado | 2 ou 3 | RESEARCH primeiro, depois REWRITE |
| BetterBe.health post inteligente | varia | RESEARCH (analisar como BR fala) |
| Insight do dashboard Longevify | 4 ou 5 | ORIGINAL |
| Tema desconhecido / emergente | TBD | RESEARCH (não pula direto pra post) |

---

## Como a decisão é registrada

No `content-object.md` da nova run:
```yaml
route: original | repurpose | rewrite | research
```

E no `idea.md`:
```yaml
route_chosen: original
route_reason: "Insight nativo sobre cortisol matinal × treino BR — sem precedente externo"
```

Essa decisão fica imutável uma vez aberta a run. Mudou de ideia → arquiva e abre nova run com outra rota.

---

## Quando o Idea Gate vira automatizado (Phase 2)

Script que:
1. Lê `stores/inbox.md` periodicamente
2. Aplica heurística + LLM call (Claude) pra classificar cada entry
3. Promove auto entries de alta prioridade pra `stores/ideas.md`
4. Sugere rota baseado na tabela acima + contexto da Foundation
5. Cria run folder esqueleto se você aprovar

Por enquanto (Phase 1): você roda mentalmente seguindo este doc.
