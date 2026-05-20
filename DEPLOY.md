# DEPLOY — Content Machine no VPS (estrutura Hermes-like)

> Migra de "tudo roda no Mac do Matheus" pra "tudo roda num VPS 24/7" — exatamente o pattern do diagrama Hermes (Layer 5 + Control Station).

## Arquitetura proposta

```
[Layer 1 — Company Brain]    brands/longevify.json + foundation/  (montado read-only em todos containers)
                  ↓
[Layer 2 — Orchestrator]     pipeline.ts                          (dispara agents abaixo)
                  ↓
[Layer 4 — Specialized agents, 1 container cada]
   writer / visual-gen / visual-qa / verifier / publish
   competitor-scan / idea-calendar / reviewer-dashboard
                  ↓
[Layer 5 — Docker isolation] cada serviço em docker-compose.yml
                  ↓
[Control Station]            VPS Hetzner/DigitalOcean + SSH alias
                             ssh longevify-vps → tmux → claude code → manage
```

## Provider options

| Provider | Custo/mês | Setup | Recomendação |
|---|---|---|---|
| **Hetzner CPX21** (3 vCPU, 4GB RAM) | ~$8 | ssh + docker compose up | ⭐ melhor custo |
| Render (background worker) | ~$25 | 1-click deploy | mais simples, mais caro |
| Railway | ~$10-20 | git push deploy | meio-termo |
| DigitalOcean Droplet (2GB) | ~$12 | ssh + docker compose up | familiar |
| AWS EC2 t3.small | ~$15 | overengineered | só se já estiver em AWS |

**Pick:** Hetzner CPX21. Próxima quarta a gente provisiona.

## Setup steps (uma vez)

```bash
# 1. SSH no VPS
ssh root@<vps-ip>

# 2. Setup base
apt update && apt install -y docker.io docker-compose git
usermod -aG docker $USER
newgrp docker

# 3. Clone repo
git clone git@github.com:longevify/content-machine.git
cd content-machine

# 4. .env
cp .env.example .env
nano .env  # cola secrets (pra produção: usa 1Password — ver SECRETS.md)

# 5. Start dashboard (serviço sempre on)
docker compose up -d reviewer-dashboard

# 6. Acessa do laptop
ssh -L 8088:localhost:8088 root@<vps-ip>
# abre http://localhost:8088
```

## Crons (via VPS crontab, não GitHub Actions)

```cron
# Segunda 07:00 BRT — competitor-scan
0 10 * * 1 cd /root/content-machine && docker compose run --rm competitor-scan >> logs/cron.log 2>&1

# Terça + quinta 07:00 BRT — idea calendar
0 10 * * 2,4 cd /root/content-machine && docker compose run --rm idea-calendar >> logs/cron.log 2>&1
```

GitHub Actions vira **backup** (caso VPS caia), não primário.

## Quando rodar pipeline (full e2e)

```bash
# Local (dev):
npm run pipeline -- --slug X --pillar 2

# Remoto (prod):
ssh longevify-vps "cd content-machine && docker compose run --rm \
  -e RUN_ID=$(date +%Y-%m-%d-001-X)-cal \
  writer && \
  docker compose run --rm visual-gen && \
  docker compose run --rm visual-qa && \
  docker compose run --rm verifier"
```

## Control Station setup (laptop/phone)

```bash
# ~/.ssh/config
Host longevify-vps
  HostName <vps-ip>
  User root
  IdentityFile ~/.ssh/longevify_ed25519
  LocalForward 8088 localhost:8088
```

Aí em qualquer terminal:
```bash
ssh longevify-vps
tmux attach -t main || tmux new -s main
# tudo dentro do tmux: claude code, logs, manage
```

## Migration path (não bloquear pra hoje)

1. ✅ Dockerfile + docker-compose criados (acabei de escrever)
2. ⏳ Provisionar VPS (~30min, $8/mês)
3. ⏳ Clone + .env + `docker compose up -d reviewer-dashboard`
4. ⏳ Mover crons GitHub Actions → VPS crontab
5. ⏳ Apontar nome `vps.longevify.com.br` (opcional)
6. ⏳ Setup tmux + ssh alias (control station)

## Pra mais tarde

- Backup automático de `runs/` e `logs/` pra S3 nightly
- Sentry/UptimeRobot pra monitorar dashboard
- Cloudflare Tunnel em vez de SSH-forward (acesso do celular)
- Health-check endpoint nos containers
