# CLAUDE.md — Regras pro agente AI nesse repo

> **🔴 SOURCE OF TRUTH OFICIAL = `/Users/mathe/Documents/Longev/Claude Code/CEO/contexto/brand-truth.md`**
> Em conflito entre este doc e brand-truth.md, **brand-truth.md vence**.
> Decisão estratégica 2026-05-17: hero ICP unificado 30-50 classe A/B + 4 personas de copy (Maria/Julia/Pedro-Carlos/Ana).
> Substitui qualquer ICP anterior ("atleta 18-60", "premium 30-55 isolado", etc).

> Leitura obrigatória no início de cada sessão. Override defaults de comportamento LLM.

## 🎯 OBJETIVO NORTH STAR (salvo 22/mai/2026)

**Post 8/10 com ≤ 20 inputs do Matheus.** Sessão Cortisol/Estresse atingiu 7/10 (mínimo postável) com ~60-80 inputs e ~3-4h. Inaceitável. Próximo post DEVE aplicar TODAS as regras consolidadas abaixo de cara — sem perguntar A/B/C, sem inventar variações fora do padrão estabelecido.

**Quando Matheus mandar referência SP/Function/Mito:** copia 99% do visual. NÃO inventa. NÃO troca metáfora (palitos = palitos). Adapta SÓ a copy pra pt-BR + voz Longevify.

---

## 🚨 Regra zero — NUNCA afirme capacidades sem checar disco

**Antes de dizer "eu não posso X" ou "não tem Y configurado" ou "isso não existe", você DEVE rodar um comando que verifique a realidade.**

Exemplos de fails reais (que NÃO podem repetir):
- ❌ "Não tenho credencial do IG Graph API configurada" — sem ter rodado `grep META .env` ou `ls scripts/publish.ts`. (Errei isso 20/mai/2026. Token tava configurado, conta `@longevify_` autenticada, `scripts/publish.ts` existia faz semanas.)
- ❌ "Não tem cron de scrape" — sem checar `.github/workflows/`
- ❌ "Sem snapshot pra esse brand" — sem rodar `ls output/analysis-*/`

**Padrão correto:**
1. Sempre que for negar uma capacidade → primeiro rodar `grep`, `ls`, `find`, ou executar o script
2. Se a verificação levar > 30s, FAÇA antes de responder, não depois
3. Se a verificação retornar AMBIGUIDADE, declare explicitamente: "rodei X, retornou Y, então provavelmente Z mas posso ter errado"

**Antidote: rode `scripts/health.sh` no início de toda sessão** pra ver o estado real do sistema. Não confie no summary de contextos anteriores — eles confabulam.

## Regras de capacidades (NUNCA esquecer)

| Capacidade | Como verificar | Status esperado |
|---|---|---|
| Publish IG | `npm run publish -- --run X --dry-run` | Token + business id no `.env`, conta `@longevify_` |
| Scrape IG | `output/analysis-*` exists | Apify token no `.env`, depende de credit |
| Scrape TikTok | `scripts/analyze-tiktoks.ts` exists | Apify + clockworks actor |
| Gen visual | `which higgsfield` ou `scripts/visual-gen.ts` | Higgsfield CLI |
| Dashboard | `cat /tmp/longevify-dashboard-url.txt` | localtunnel ou cloudflare |

## Regras de timing pra publish

**Cronograma fixo 4×/semana — locked 22/mai/2026 (NUNCA postar fora desses horários):**

| Dia | Slot | Tipo | Carga |
|---|---|---|---|
| Dom | 10h BRT | Carrossel premium / Manifesto | ⭐⭐⭐ |
| Seg | — | OFF | descanso editorial |
| Ter | 19h BRT | Dado punch (single image OU carrossel curto) | ⭐⭐ |
| Qua | — | OFF | — |
| Qui | 19h BRT | Carrossel premium deep-dive técnico | ⭐⭐⭐ |
| Sex | 19h BRT | **PERSONA-BIO carrossel** — persona carioca diferente toda sex, narrativa: sintomas → painel → protocolo → resultado 6 sem. Estabelecido 22/mai/2026 a partir da Julia (Sauna Lagoa). | ⭐⭐⭐ |
| Sáb | — | Stories only (recap, repost) | — |

**Por quê 4 (não 7):** Mito/Function/SP postam 2-4x/sem. Premium brand precisa cada post justificar lugar. 7x dilui. Cadência atual = 3 heavyweights + 1 punch + stories sáb.

**Reels:** sem slot fixo. Quando produzir, encaixar como bônus em qua OU como stories amplificação no sáb. Não obrigatório semanal.

**Por quê:** algoritmo IG penaliza posts fora do horário de pico da audiência. Esses horários foram calibrados via análise de competidores (Function Health, Mito, Superpower). Nunca antecipe "porque tá pronto agora" — engajamento despenca.

**Auto-publish via cron NUNCA sem trigger explícito do Matheus.** Lição: ApoB foi publicado sem comando 17/mai → Matheus apagou. Regra: só publica quando ele escreve "posta", "vai", "publica" ou marca aprovação no dashboard.

## Regras de geração de conteúdo

1. **Voz Longevify** = Mito (precisão técnica) + Aesop (restrição editorial). NUNCA self-help, NUNCA fear, NUNCA promessa de cura, NUNCA persona-específica que exclui leitor.
2. **Paleta locked (uso por contexto):**
   - **Slides cover/hero (Aesop-style):** warm cream taupe `#D8D2C5` → `#BBB4A2` → `#A29B89` → `#8B8577` (paleta SP/Mito/Function). Texto branco/cream sobre warm. Salvada 21/mai/2026 pelo Matheus.
   - **Slides técnicos densos:** forest `#1C3F3A` ainda OK, mas precisa fotografia/textura no fundo, NUNCA cor sólida flat (Matheus: "fundo verde sem graça não vende").
   - **Accent gold:** `#C89136` permitido só pra numeração editorial sutil. Proibido em saturação alta.
   - **Proibido sempre:** vermelho, âmbar puro, laranja, white #FFFFFF, sépia warm golden hour saturado.
3. **Logo:** sempre bottom-center, **25% width LOCKED** (consistência entre posts no feed). Padding bottom 5-7% do canvas. NUNCA o 2000x2000 stacked, só o horizontal. Crop 78% top do trimmed bbox pra remover a linha decorativa.
   - **REGRA SALVA 21/mai/2026 (Matheus):** logos têm que aparecer com MESMA proporção no feed. Diferenças entre posts quebram brand identity.
   - **LOGO COR CONSISTENTE no carrossel inteiro 21/mai/2026 (Matheus):** se a capa tem logo branca, TODOS os slides têm logo branca. Nunca alternar branca/dark dentro do mesmo carrossel (mesmo se o fundo permitir as duas). Default: **logo BRANCA** sobre paleta warm taupe/cream Longevify.
4. **Tipografia (LOCKED 21/mai/2026):** **Inter** (Light 300 pra headline, Regular 400 pra sub). Instalada em `~/Library/Fonts/` + `assets/fonts/`. NÃO usar Playfair serif, NÃO usar DM Sans, NÃO usar Georgia em cover. Inter exclusivamente até nova ordem.
5. **Composição cover:** headline grande centralizado + sub menor centralizado abaixo + logo bottom-center 25%. SEM kicker tipo "ESTRESSE · 01" (SP não usa, parece feio). Vibe SP "Is cortisol burning you out?" exata.
6. **Visual cover (CRÍTICO):** foto editorial Higgsfield (nano_banana_2) sobre paleta warm cream/taupe. Metáfora visual (objeto-conceito) > fotografia humana. NUNCA rosto humano detalhado (risco AI uncanny valley). Aprovados: palitos queimados (burnout), vela derretida, calçadão pedras portuguesas, paisagem Rio na névoa, microscopy editorial (mas evitar gold saturado).
7. **Copy headline + sub padrão:** headline = paradoxo/silêncio/biológico curto (max 6 palavras), tom Mito+Aesop. Sub = oferta de produto/protocolo, NÃO self-help genérico.
   - Aprovado: "Cortisol está te queimando em silêncio." + "Crie um protocolo pra restaurar o ritmo."
   - Rejeitado: "Cortisol fora de hora?", "Aqui está como redefinir." (genérico SP-literal)
4. **Idioma:** pt-BR puro. Inglês só pra termos consagrados (hs-CRP, ApoB).
5. **Sem emoji** salvo 🇧🇷 ou ❄️ contextual raro.
6. **Sem hashtag** decorativo.

## Regras de comunicação

1. **Proatividade > educação.** Matheus prefere "fiz X" sobre "quer que eu faça X?". Mas não publica sem trigger.
2. **Quando errar: admite, mostra causa raiz, conserta engenharia.** Não desculpa fofa.
3. **Honestidade > polidez.** "Não sei" vale mais que invenção.

## Comandos canônicos

```bash
# Health check completo
./scripts/health.sh

# Subir dashboard (server + tunnel + watchdog)
nohup ./scripts/dashboard-supervisor.sh > /tmp/longevify-supervisor.log 2>&1 &

# Publish run aprovado
npm run publish -- --run <run-id> [--dry-run] [-v]

# Scrape competidores IG (custa Apify credit)
npm run analyze-instagrams

# Scrape competidores TikTok
npm run analyze-tiktoks
```

<!-- redeploy trigger: Thu May 21 13:06:58 -03 2026 -->
