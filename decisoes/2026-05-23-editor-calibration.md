# Editor Calibration · 2026-05-23

## Padrão #1 capturado: em-dash overuse

**Sinal:** founder aprovou 25/25 drafts na rodada de labeling mas flagou:
> "uso excessivo de travessões (—) em quase todos os drafts"

**Categoria:** AI tell. Modelos LLM saem da fábrica viciados em em-dash como
glue retórico. Brand-truth já cobre "estoque genérico AI", mas o scanner não
tinha contador específico — passou batido.

## Distribuição medida (21 drafts com Caption)

```
em-dash count per caption (Unicode U+2014 + " - " ASCII):
mean   1.62
median 2
p90    3
max    4
min    0

histogram:
  0: 4 drafts (19%)
  1: 5 drafts (24%)
  2: 8 drafts (38%)  ← modal
  3: 3 drafts (14%)
  4: 1 draft  ( 5%)
```

(Tool de medição: `scripts/agents/em-dash-measure.mjs`, run-able a qualquer
momento pra recalibrar.)

## Threshold definido (Editor v1.2)

Adicionado ao stage 1 deterministic do avoid-slop scanner:

| count | severity | action     |
|------:|----------|------------|
| 0-1   | —        | pass       |
| 2-3   | medio    | REVISE (deduct) |
| 4+    | grave    | REJECT auto |

Conta soma de: U+2014 (—), U+2013 (–), e " - " (espaço-hífen-espaço)
usado como travessão ASCII barato.

**Justificativa:** distribuição mostra que 0-1 é a faixa natural quando o
escritor é consciente; 2+ revela autopiloto LLM. 4 é gritante (1 draft no
sample).

## Verdict re-scan dos 21 drafts existentes

```
ok:     7 (33%)
deduct: 13 (62%)  ← REVISE pendente
reject: 1 ( 5%)   ← 2026-05-13-001-biomarker-watch-list (4 em-dashes)
```

14/21 (67%) falhariam com a nova régua. Founder definiu "se >5 falham =
sinal de que muitos approves foram leniência" — 14 confirma com folga que a
rodada de labeling tava cega pra esse padrão. Próxima rodada deveria
re-labelar esses 14 com em-dash em mente.

## Rubric de regeneração

Quando editor rejeita por em-dash overuse, o prompt do regenerator inclui
hint:

> Reduza travessões (—) pra ≤1 por caption. Substituições:
> 1. Ponto final + frase nova
> 2. Dois pontos (quando o que vem depois é definição/expansão)
> 3. Vírgula (quando é aposição curta)
> 4. Reescrever a frase pra eliminar a necessidade

## Implementação

- `scripts/agents/avoid-slop-scan.mjs`: bloco "5a. em-dash overuse" entre
  emoji policy e tom patterns. Não vai pra YAML porque thresholds count-based
  não são expressáveis no schema atual (banned_phrases/tokens/regex são
  match-or-not, sem buckets).
- `scripts/agents/em-dash-measure.mjs`: tool one-shot pra recalibrar
  distribuição se padrões mudarem.
- `scripts/agents/em-dash-rerun.mjs`: re-scanner pra ver impacto antes de
  shadow mode.

## Ação seguinte

1. Shadow mode editor com avoid-slop v1.2 nos próximos drafts gerados.
2. Re-labelar os 14 drafts que falharam (priorizar 2026-05-13-001 que é
  reject).
3. Se padrão em-dash não dropar nos próximos 10 drafts, reduzir threshold
  pra ≤1 reject (atualmente 4+).
