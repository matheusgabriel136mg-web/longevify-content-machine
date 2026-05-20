# Dashboard Deploy — Railway vs Hetzner

> Dashboard precisa rodar 24/7 na nuvem pra você + Valle acessarem de qualquer lugar.
>
> **2 caminhos.** Recomendo Railway primeiro (10min, $5/mês), Hetzner depois quando dominar Docker.

---

## Option A — Railway (RECOMENDADO pra começar)

**Por quê:** push GitHub → deploy automático. HTTPS nativo. Painel UI pra env vars. Volume persistente.
**Custo:** $5/mês free credit + $0.0003/min após. Estimativa real: $5-10/mês.

### Steps (10min)

1. **Cria conta**: https://railway.app → "Login with GitHub"

2. **Conecta repo**: depois que `gh auth login` + push do `content-machine` pro GitHub:
   - New Project → Deploy from GitHub repo → `content-machine`
   - Railway detecta `Dockerfile` automaticamente

3. **Configura env vars**: Railway UI → Variables (cola do seu `.env` local):
   ```
   ANTHROPIC_API_KEY=...
   APIFY_API_TOKEN=...
   META_APP_ID=1738157740871611
   META_APP_SECRET=...
   META_PAGE_ACCESS_TOKEN=...
   IG_BUSINESS_ACCOUNT_ID=17841475488336744
   CLOUDINARY_URL=...
   DASHBOARD_USER=longevify
   DASHBOARD_PASS=<senha-forte>
   PORT=8088
   ```

4. **Volume persistente** (pra runs/ e logs/ não sumirem em redeploy):
   - Settings → Volumes → New Volume
   - Mount path: `/app/runs` (e outro pra `/app/logs`, `/app/output`)
   - Size: 5GB suficiente

5. **Override CMD** pra rodar o server em vez do pipeline:
   - Settings → Deploy → Custom Start Command:
   ```
   node --import tsx/esm scripts/server.ts
   ```

6. **Domain**: Settings → Networking → Generate Domain
   - Vai dar algo tipo `content-machine-prod.up.railway.app`
   - Acessa com user/pass que você setou em DASHBOARD_USER/PASS

7. **Cron jobs**: Railway suporta cron via "Cron Jobs" no UI:
   - daily-scrape: `0 9 * * *` → command `node --import tsx/esm scripts/analyze-instagrams.ts`
   - competitor-scan: `0 10 * * 1` → command `node --import tsx/esm scripts/competitor-scan.ts`
   - idea-calendar: `0 10 * * 2,4` → command `node --import tsx/esm scripts/idea-calendar.ts`
   - brand-drift: `0 11 * * 5` → command `node --import tsx/esm scripts/brand-drift-detector.ts`

**Pronto.** Acessa `https://content-machine-prod.up.railway.app` com user/pass.

---

## Option B — Hetzner VPS (barato + controle total)

**Por quê:** $8/mês fixo. SSH + Docker = controle absoluto. Boa pra escalar futuro.
**Custo:** $8/mês CPX21 (3vCPU/4GB) — sem variável.

### Steps (~45min primeira vez)

1. **Cria conta**: https://www.hetzner.com/cloud → cartão de crédito
2. **Cria servidor**:
   - New Project: `longevify`
   - Add Server:
     - Location: **Falkenstein** (Europa, mais barato) ou **Ashburn** (US East, mais perto BR)
     - Image: **Ubuntu 24.04**
     - Type: **CPX21** ($8/mês)
     - SSH Key: cole sua chave pública (`~/.ssh/id_ed25519.pub`) ou cria nova
     - Name: `longevify-prod`
   - Anota IP

3. **Setup base no servidor** (você roda local):
   ```bash
   ssh root@<IP>
   apt update && apt install -y docker.io docker-compose git
   git clone https://github.com/<seu-user>/content-machine.git
   cd content-machine
   cp .env.example .env
   nano .env  # cola todas as env vars (mesma lista do Railway acima + DASHBOARD_PASS)
   ```

4. **Sobe dashboard**:
   ```bash
   docker compose up -d --build
   # Ou só o serviço de dashboard:
   docker run -d --name longevify-dashboard \
     --env-file .env \
     -p 8088:8088 \
     -v $(pwd)/runs:/app/runs \
     -v $(pwd)/logs:/app/logs \
     -v $(pwd)/output:/app/output \
     content-machine \
     node --import tsx/esm scripts/server.ts
   ```

5. **HTTPS + domain** (recomendado, gratuito via Caddy):
   ```bash
   apt install -y caddy
   echo "dash.longevify.com.br {
     reverse_proxy localhost:8088
   }" > /etc/caddy/Caddyfile
   systemctl restart caddy
   ```
   - DNS: cria A record `dash.longevify.com.br → <IP>`
   - Caddy emite SSL Let's Encrypt automático

6. **Crons** (VPS crontab, não GitHub Actions):
   ```bash
   crontab -e
   ```
   Cola:
   ```cron
   0 9 * * * cd /root/content-machine && docker compose run --rm scrape node --import tsx/esm scripts/analyze-instagrams.ts >> logs/cron.log 2>&1
   0 10 * * 1 cd /root/content-machine && docker compose run --rm scan node --import tsx/esm scripts/competitor-scan.ts >> logs/cron.log 2>&1
   0 10 * * 2,4 cd /root/content-machine && docker compose run --rm cal node --import tsx/esm scripts/idea-calendar.ts >> logs/cron.log 2>&1
   0 11 * * 5 cd /root/content-machine && docker compose run --rm drift node --import tsx/esm scripts/brand-drift-detector.ts >> logs/cron.log 2>&1
   ```

7. **Acessa**: `https://dash.longevify.com.br` com user/pass.

---

## Comparação

| | Railway | Hetzner |
|---|---|---|
| Setup | 10min | 45min |
| Custo | $5-10/mês | $8/mês fixo |
| HTTPS | nativo | manual (Caddy) |
| Domain custom | extra ($2/mês) | gratuito (você DNS) |
| Escalabilidade | auto | manual |
| Acesso SSH | não | sim |
| Curva | baixa | média |

**Pra Longevify hoje (2 users, low traffic, MVP)**: Railway.
**Quando crescer (10+ users, custom workflows, monitoring complexo)**: migrar pra Hetzner.

---

## Pós-deploy: smoke tests

```bash
# 1. Health check
curl -u longevify:<pass> https://<url>/api/ops

# 2. Feed (vai aparecer só se rodou analyze-instagrams pelo menos 1x)
curl -u longevify:<pass> https://<url>/api/feed

# 3. Review queue (vai aparecer drafts/verified runs)
curl -u longevify:<pass> https://<url>/api/review-queue
```

Se algum falhar, log:
```bash
# Railway
railway logs

# Hetzner
docker logs longevify-dashboard --tail 100
```

---

## Custos totais estimados (mês)

- VPS/Railway: **$5-10**
- Anthropic (writer + verifier + visual-qa rodando): **$30-80** (depende de volume)
- Higgsfield (visual-gen): **$15-30** (3 posts/semana × 6 slides × $0.50)
- Apify (scrapes): **$5-15**
- Cloudinary: **$0** (free tier 25GB)

**Total realista: $60-130/mês** pra rodar autônomo gerando 12 posts/mês.
