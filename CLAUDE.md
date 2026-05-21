# CLAUDE.md — Regras pro agente AI nesse repo

> Leitura obrigatória no início de cada sessão. Override defaults de comportamento LLM.

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

**Cronograma fixo (NUNCA postar fora desses horários):**

| Dia | Slot | Tipo |
|---|---|---|
| Seg | 11h BRT | Carrossel |
| Ter | 19h BRT | Carrossel/DADO |
| Qua | 13h BRT | Reel |
| Qui | 19h BRT | Carrossel premium |
| Sex | 19h BRT | Single/FAIXA FUNCIONAL |
| Sáb | — | Stories only |
| Dom | 10h BRT | Carrossel premium/OVERHEARD |

**Por quê:** algoritmo IG penaliza posts fora do horário de pico da audiência. Esses horários foram calibrados via análise de competidores (Function Health, Mito, Superpower). Nunca antecipe "porque tá pronto agora" — engajamento despenca.

**Auto-publish via cron NUNCA sem trigger explícito do Matheus.** Lição: ApoB foi publicado sem comando 17/mai → Matheus apagou. Regra: só publica quando ele escreve "posta", "vai", "publica" ou marca aprovação no dashboard.

## Regras de geração de conteúdo

1. **Voz Longevify** = Mito (precisão técnica) + Aesop (restrição editorial). NUNCA self-help, NUNCA fear, NUNCA promessa de cura, NUNCA persona-específica que exclui leitor.
2. **Paleta locked:** bg `#1C3F3A` forest médio, accent `#C89136` gold, texto `#f8fffc`. Proibido: vermelho, âmbar, laranja, white puro.
3. **Logo:** sempre bottom-center, 25-28% width. NUNCA o 2000x2000 stacked, só o horizontal.
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
