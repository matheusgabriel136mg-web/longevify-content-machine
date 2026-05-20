# SECRETS — secret management plan

> Hoje: `.env` plaintext local + GitHub Actions Secrets remoto. **Risco médio** se repo público; **baixo** enquanto privado.
>
> Plano: migrar pra 1Password CLI (gratuito p/ Family plan) OU Doppler (free 5 envs). Sem rotação automática hoje.

## Estado atual (auditoria)

| Secret | Onde | Risco |
|---|---|---|
| `ANTHROPIC_API_KEY` | `.env` + GitHub secret | médio se vazar (custo) |
| `APIFY_API_TOKEN` | `.env` + GitHub secret | baixo (escopo limitado) |
| `META_APP_SECRET` | (futuro) `.env` | alto (controle da app IG) |
| `META_PAGE_ACCESS_TOKEN` | (futuro) `.env` | alto (publica em nome da página) |
| `CLOUDINARY_URL` | (futuro) `.env` | médio (uploads ilimitados se vazar) |
| `GOOGLE_API_KEY` | `.env` | médio |

## Plano de migração (V2 — não bloquear hoje)

### Opção A — 1Password CLI (recomendado)
```bash
brew install --cask 1password-cli
op signin
op vault create longevify-content-machine
# Importa cada secret:
op item create --category="API Credential" --vault=longevify-content-machine \
  --title="ANTHROPIC_API_KEY" credential="<valor>"
```

Usage em scripts:
```bash
# em vez de:
node --env-file=.env scripts/writer.ts
# usa:
op run --env-file=.env.op -- node scripts/writer.ts
```
Onde `.env.op` referencia secrets via `op://longevify-content-machine/ANTHROPIC_API_KEY/credential`.

### Opção B — Doppler (alternativa cloud)
- Setup web em 5min
- Inject via `doppler run -- node ...`
- Sincroniza com GitHub Actions secrets via service token

## Quando migrar
- **Hoje**: .env continua, mas adiciona `.env` ao `.gitignore` (já está)
- **Próxima semana**: setup 1Password vault + migra ANTHROPIC + META keys
- **Quando time crescer (>1 dev)**: obrigatório migrar — não compartilhar `.env` por DM

## Rotação
- Sem automação hoje
- Quando migrar pra 1Password: rotação manual a cada 90 dias (calendar event)
- Token Meta IG: a cada 60 dias é obrigatório (curto-prazo, vence sozinho)

## Repository safety
- `.gitignore` já inclui `.env`, `.env.*`, `*.key`, `*.pem`
- Pre-commit hook (futuro): `git-secrets` ou `gitleaks` pra bloquear push acidental
- Se algum secret VAZOU em commit antigo: rotaciona imediatamente, depois `git filter-repo` pra limpar history

## Action items (priorizado)
1. **Hoje**: adicionar `gitleaks` pre-commit (5min)
2. **Quando setar Meta**: já cria no 1Password, não no .env
3. **Próximo refactor**: migrar todo o .env pra 1Password CLI
