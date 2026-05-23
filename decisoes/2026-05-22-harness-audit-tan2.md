# Harness Audit — Tan Principle #2

> **2026-05-22 — D1 noite**
> **Princípio Tan #2:** "Model em loop, sem fat tools. Anti-padrão: 40+ tools comendo metade do contexto."

## Estado atual

**Não existe `pipeline.ts` ainda.** O que existe:
- `scripts/render-*.mjs` (renderers individuais Sharp+SVG)
- `scripts/publish.ts` (publisher IG Graph API)
- `scripts/agents/*.mjs` (queue, planner, approver, critic, critic-fix-loop, editor-agent, avoid-slop-scan, compliance-scan, telegram-notify, safe-rm)

**Implica:** o pipeline atual é "scripts soltos chamados manualmente". Cada script tem seu próprio contexto. Não há tool/skill carregada que coma o contexto do orchestrator.

## Anti-pattern Tan que VAMOS EVITAR no orchestrator (D1)

```ts
// ❌ ERRADO: orchestrator com 40 tools/skills carregados no boot
const orchestrator = new Agent({
  tools: [renderTool, publishTool, criticTool, fixLoopTool, planTool,
          approverTool, queueTool, slopTool, complianceTool, telegramTool,
          ...40_more...],
  systemPrompt: `${claudeMd}\n${voiceMd}\n${pillarsMd}\n${slopRules}\n
                 ${cfmRules}\n${personaKw}\n...10000 lines...`
});
```

Razões pra evitar:
- Contexto do orchestrator vira 50k+ tokens só pra "saber o que existe"
- Cada decision consome contexto crescente
- LLM perde foco entre 40 ferramentas

## Pattern Tan que VAMOS APLICAR

```ts
// ✅ CERTO: orchestrator narrow + invoca skills/agents SOB DEMANDA
const orchestrator = new StateMachine({
  states: ["draft", "rendering", "editing", "approving", "publishing", "published", "failed"],
  transitions: {
    draft: { onTrigger: () => spawnAgent("generator", { run_id }) },
    rendering: { onComplete: () => spawnAgent("editor-agent", { run_id }) },
    editing: {
      onApprove: () => transition("approving"),
      onRevise: () => spawnAgent("generator-revise", { run_id, fix_notes }),
      onReject: () => transition("failed", { reason }),
      onEscalate: () => spawnAgent("telegram-notify", { severity: "critical", run_id }),
    },
    approving: { onApprove: () => transition("publishing") },
    publishing: { onComplete: () => transition("published") },
    failed: { /* terminal */ },
    published: { /* terminal — feedback loop pega depois */ },
  },
  context: {
    // ZERO Markdown carregado. Pointers apenas.
    brand_truth_path: "/Users/mathe/.../CEO/contexto/brand-truth.md",
    voice_path: "foundation/voice.md",
    pillars_path: "foundation/pillars.md",
  },
  audit_log: "runs/_audit-log.jsonl",
  safety_nets: ["cost_breaker", "quality_breaker", "compliance_breaker"],
});
```

Razão de cada princípio:
- **State machine vs free-form agent loop:** transições determinísticas. LLM não decide o NEXT — só executa o "what" do estado atual.
- **Context = pointers, não markdown carregado:** cada agent spawn carrega só o que precisa. Editor-agent não precisa do CFM blocklist completo se já passou pelo compliance-scan.
- **Audit log estruturado (JSONL):** queryable, replayable, debuggable. Não free text em md.
- **Safety nets como middleware:** TODA transição passa pelos breakers. Sem bypass.

## Decisões pra orchestrator (D1-D2)

| # | Decisão | Valor |
|---|---|---|
| 1 | Linguagem | TypeScript (consistência com publish.ts atual) |
| 2 | Persistência | SQLite (single file, zero infra, backupable) |
| 3 | State machine lib | xstate? Ou hand-rolled? → **hand-rolled** (Tan #2: narrow, sem fat dep) |
| 4 | Audit log format | JSONL (1 line per event, append-only) |
| 5 | Trigger mode | Cron + manual CLI |
| 6 | Concurrent runs | Max 3 (paralelizado mas não unbounded) |
| 7 | Failed state recovery | Manual reset via CLI: `pipeline reset --run X` |

## Implementação D1 (próximo)

`scripts/pipeline.ts` skeleton:
```
StateMachine
  ├─ Load runs/_queue.json + SQLite state
  ├─ For each unfinished run:
  │   ├─ Check safety nets (cost/quality/compliance)
  │   ├─ Get current state
  │   ├─ Execute transition handler
  │   ├─ Write audit entry
  │   └─ Persist state to SQLite
  └─ Telegram notify se ESCALATE
```

## Pós-implementação: re-audit harness

Após pipeline.ts pronto, medir:
- Linhas de código (target: <500 main loop)
- Contexto consumido em startup (target: <5KB de markdown + 0 tools embeddados)
- Quantas tools/skills invocadas em 1 run típico (target: <8)

Se ultrapassar → refactor pra split em sub-orchestrators.
