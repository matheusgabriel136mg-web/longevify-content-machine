# VPS + Telegram Bot Setup Guide (D0)

> Tasks que **Matheus precisa fazer** (não posso provisionar conta paga nem criar bot Telegram interativamente). Estimativa: 30-45min total.

---

## 1. VPS Hetzner CX22 (~R$35/mês)

### Provisionamento (15min)

1. Cria conta em https://www.hetzner.com/cloud (se ainda não tem)
2. Add billing (CC ou SEPA)
3. Cria novo Project: `longevify-content-machine`
4. Add SSH key:
   ```bash
   # No seu Mac, se ainda não tem:
   ssh-keygen -t ed25519 -C "longevify-cm" -f ~/.ssh/longevify_cm
   cat ~/.ssh/longevify_cm.pub
   # Cola o output no Hetzner → Project → Security → SSH Keys
   ```
5. **Create Server:**
   - Location: `Falkenstein` (lowest cost, fine)
   - Image: `Ubuntu 24.04`
   - Type: `CX22` (4 vCPU shared, 8GB RAM, 40GB SSD, €5.83/mo)
   - Network: IPv4 (padrão)
   - SSH Keys: select longevify_cm
   - Name: `longevify-cm-01`
   - Click Create
6. Pega o **IPv4** do server (algo tipo `116.203.X.X`)

### Bootstrap (10min — me passa o IP, eu rodo)

Salva no Bitwarden (entry: "longevify-vps-hetzner"):
- IP: `<IP do server>`
- User: `root`
- SSH key path: `~/.ssh/longevify_cm`

Eu rodo o bootstrap automaticamente após você compartilhar:
```bash
ssh -i ~/.ssh/longevify_cm root@<IP> "bash -s" < scripts/vps/bootstrap.sh
```

(O `bootstrap.sh` vai instalar: node 22, git, sqlite, ffmpeg, ImageMagick, higgsfield CLI, npm deps, clona repo, cria env file template, configura systemd timer pro cron 7am.)

### Alternativa Contabo (~R$28/mês)
Se preferir mais barato: Contabo VPS S (4 vCPU, 8GB RAM, 200GB SSD, €4.50/mo). Mesma setup, IP differente.

---

## 2. Telegram Bot (15min)

### Criar bot

1. Telegram app → procura `@BotFather`
2. Manda `/newbot`
3. Nome: `Longevify Content Machine` (qualquer)
4. Username: `longevify_cm_bot` (precisa terminar em `bot`, ser único)
5. BotFather devolve um **token** tipo `7XXXXX:AAH...` — **SALVA NO BITWARDEN**
6. Manda `/setprivacy` → seleciona o bot → `Disable` (pra bot ler msgs em grupos se quiser depois)

### Pegar seu chat_id

1. Telegram → procura o bot que acabou de criar
2. Manda qualquer mensagem (`oi`)
3. No browser: `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
4. Procura `"chat":{"id":<NUMERO>,...}` — esse número é seu chat_id
5. **SALVA NO BITWARDEN** (entry: "longevify-telegram")

### Salvar no .env (do Mac e VPS)

Adiciona em `/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/.env`:
```
TELEGRAM_BOT_TOKEN=7XXXXX:AAH...
TELEGRAM_CHAT_ID=123456789
```

### Test

```bash
cd /Users/mathe/Documents/Longev/Brand/Longevify/content-machine
node scripts/agents/telegram-notify.mjs --test
```

Deve cair msg "🤖 Test message from content-machine. Setup OK." no seu Telegram em ~2s.

---

## 3. Após VPS bootstrap (eu faço)

Vou configurar no VPS:
- Cron `7:00 BRT` → Daily Content Brief Diarization #1 → push Telegram
- Cron `3:00 BRT semana` → Foundation Auto-Updater Diarization #2 → push Telegram (PR proposta)
- Cron `domingo 23:00 BRT` → Cross-version Diarization #3 → push Telegram
- Cron `1º dia do mês 3:00 BRT` → Brand Drift Diarization #4 → push Telegram
- Cron a cada 15min → check publish queue → se slot próximo, push trigger

Audit log + backups:
- SQLite `runs.db` backup diário → R2 Cloudflare
- Lifecycle policy R2: depois de 12 meses move pra Glacier

---

## 4. Próximos passos pós-setup

Você fez 1 + 2 acima? Me responde:
- ✓ VPS IP: `<IP>`
- ✓ Telegram token + chat_id salvos em .env
- ✓ Test do telegram-notify deu OK

Aí eu termino:
- Bootstrap VPS (rodo o script)
- Migra repo content-machine pro VPS (git clone + env file)
- Configura crons systemd
- D1 começa: editor agent v1 com latent vs deterministic

---

## Custo mensal estimado

| Item | Custo |
|---|---|
| Hetzner CX22 | €5.83 (~R$35) |
| Cloudflare R2 (audit logs) | $0-5 (~R$25) tier free até 10GB |
| **Total infra** | **~R$60/mês** |
| Anthropic API (16 posts/mês × $2) | ~R$160 |
| Higgsfield (Plus plan upgrade quando escalar) | ~R$200 |
| **Total operacional** | **~R$420/mês** |

Pra 20-30 posts/dia (escala A/B): +Higgsfield Pro upgrade (~R$800/mês adicional) + Anthropic tier 4 (~R$2k/mês).
