# VPS + Telegram Pre-Flight Checklist (sex 23 noite)

> Pra zero-friction setup. Faz cada item antes de SSH no VPS.

---

## ✅ Hetzner CX22 — pre-purchase

### Conta Hetzner
- [ ] Conta criada em https://accounts.hetzner.com/signUp
- [ ] **Cartão de crédito internacional aceito** (Visa/Master comum BR funciona — eles processam em EUR mas charge em BRL via Visa)
  - Alternativa SEPA: requer conta europeia, ignore
  - Confirmação de cobrança: ~R$35-45/mês (depende do câmbio + IOF 6.38% do cartão)
- [ ] Verificação de identidade pode pedir (geralmente foto do CC + selfie, ~10min)
- [ ] Project criado: `longevify-content-machine`

### SSH key local (faça AGORA antes de logar no Hetzner)
```bash
# No seu Mac:
ssh-keygen -t ed25519 -C "longevify-cm" -f ~/.ssh/longevify_cm
# Senha vazia OK (use 1Password/Bitwarden pra password manager se quiser)
cat ~/.ssh/longevify_cm.pub
# Copia o output — vai colar no Hetzner
```
- [ ] SSH key gerada
- [ ] `.pub` colada em Hetzner → Project → Security → SSH Keys

### Server creation (10min após conta pronta)
- [ ] Location: **Falkenstein** (cheaper, fine for our use)
- [ ] Image: **Ubuntu 24.04**
- [ ] Type: **CX22** (4 vCPU shared, 8GB RAM, 40GB SSD, €5.83/mo)
- [ ] Network: IPv4 (padrão)
- [ ] SSH Keys: select `longevify_cm`
- [ ] Name: `longevify-cm-01`
- [ ] **SALVA NO BITWARDEN** (entry: `longevify-vps-hetzner`):
  - IP: `<IPv4>`
  - User: `root`
  - SSH key path: `~/.ssh/longevify_cm`
  - Provider: Hetzner
  - Region: Falkenstein

### Smoke test SSH
```bash
ssh -i ~/.ssh/longevify_cm root@<IPv4> "echo OK"
# Deve responder: OK
```
- [ ] SSH funciona

---

## ✅ Telegram Bot — pre-config

### 1. Bot criado via @BotFather (3min)
- [ ] Telegram app → procura `@BotFather` → `/newbot`
- [ ] Nome bot: `Longevify Content Machine`
- [ ] Username: `longevify_cm_bot` (precisa ser único, terminar em `bot`)
- [ ] Salva o **token** (formato `7XXXXX:AAH...`)
- [ ] **SALVA NO BITWARDEN** (entry: `longevify-telegram`):
  - Bot token: `7XXX:...`
  - Bot username: `@longevify_cm_bot`

### 2. chat_id (1min)
- [ ] Manda qualquer msg (`oi`) pro seu bot
- [ ] Browser: `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
- [ ] Pega o `"chat":{"id":<NÚMERO>,...}` — esse número é seu chat_id
- [ ] **SALVA NO BITWARDEN** (mesma entry): `chat_id: 123456789`

### 3. Privacy + persistence
- [ ] `@BotFather` → `/setprivacy` → seleciona bot → **Disable** (caso queira usar em grupos depois)
- [ ] `@BotFather` → `/setcommands` → cola:
  ```
  status - Pipeline status (eq. node pipeline.mjs status)
  brief - Daily brief now (eq. node daily-brief.mjs)
  posts - Lista publicados últimos 7d
  insights - Ranking insights atual
  ```

---

## ✅ Lista de env vars que vou precisar setar no VPS

```bash
# .env no VPS (vai ficar em /opt/content-machine/.env)
ANTHROPIC_API_KEY=sk-ant-...           # já tem no .env local — copia
HIGGSFIELD_API_KEY=...                  # já tem
APIFY_API_TOKEN=...                     # já tem
META_PAGE_ACCESS_TOKEN=...              # já tem
IG_BUSINESS_ACCOUNT_ID=...              # já tem
META_PAGE_ID=...                        # já tem
META_APP_ID=...                         # já tem
META_APP_SECRET=...                     # já tem
CLOUDINARY_URL=cloudinary://...         # já tem
TELEGRAM_BOT_TOKEN=7XXX:AAH...          # NOVO — do passo Telegram
TELEGRAM_CHAT_ID=123456789              # NOVO — do passo Telegram
```

Comando pra copiar do Mac local pro VPS:
```bash
scp -i ~/.ssh/longevify_cm /Users/mathe/Documents/Longev/Brand/Longevify/content-machine/.env root@<IP>:/tmp/.env-base
# No VPS, mover + adicionar Telegram vars:
ssh -i ~/.ssh/longevify_cm root@<IP> "mkdir -p /opt/content-machine && cat /tmp/.env-base > /opt/content-machine/.env && rm /tmp/.env-base"
ssh -i ~/.ssh/longevify_cm root@<IP> "echo 'TELEGRAM_BOT_TOKEN=...' >> /opt/content-machine/.env && echo 'TELEGRAM_CHAT_ID=...' >> /opt/content-machine/.env"
```

---

## ✅ Comando smoke test pós-setup

Eu (content-machine) rodo o bootstrap. Quando terminar, valida:

```bash
# 1. SSH funciona
ssh -i ~/.ssh/longevify_cm root@<IP> "node --version && git --version && sqlite3 --version"
# Espera: v22+, git 2.x, sqlite 3.x

# 2. Repo clonado
ssh -i ~/.ssh/longevify_cm root@<IP> "cd /opt/content-machine && git log --oneline -3"
# Espera: últimos 3 commits

# 3. .env legível + Anthropic responde
ssh -i ~/.ssh/longevify_cm root@<IP> "cd /opt/content-machine && node -e \"
import('@anthropic-ai/sdk').then(async({default:A})=>{
  const a = new A();
  const r = await a.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:20,messages:[{role:'user',content:'say OK'}]});
  console.log(r.content[0].text);
})\""
# Espera: OK

# 4. Telegram test
ssh -i ~/.ssh/longevify_cm root@<IP> "cd /opt/content-machine && node scripts/agents/telegram-notify.mjs --test"
# Espera: msg "🤖 Test message from content-machine. Setup OK." no seu Telegram em 2s

# 5. Pipeline status
ssh -i ~/.ssh/longevify_cm root@<IP> "cd /opt/content-machine && node scripts/pipeline.mjs status"
# Espera: tabela com states + upcoming

# 6. Cron timer
ssh -i ~/.ssh/longevify_cm root@<IP> "systemctl list-timers --no-pager | grep longevify"
# Espera: 3-4 timers (morning-brief, insights-scraper, idea-picker, cross-version)
```

Tudo passou? VPS está pronto pra D3 (shadow mode).

---

## 💸 Custos esperados primeiro mês

| Item | Custo |
|---|---|
| Hetzner CX22 | €5.83 (~R$35) |
| Cloudflare R2 (audit log backups) | $0 (free tier 10GB) |
| Anthropic API (~16 posts × $1) | ~R$80 |
| Higgsfield Plus (já paga) | ~R$200 |
| Cloudinary (já dentro do free) | R$0 |
| **TOTAL** | **~R$315/mês** |

Pra 20-30 posts/dia futuro: +Higgsfield Pro (~R$800) + Anthropic Tier 4 (~R$1.5k).

---

## 🚨 Se algo der errado

- SSH refuse: re-confirma SSH key foi colada certinho no Hetzner Project (não em "Personal")
- Telegram não envia: 99% das vezes é chat_id errado (precisa ser número, não @username)
- Bootstrap node fail: Ubuntu 24.04 vem com node 18, mas precisa 22+. Bootstrap script trata via `curl https://deb.nodesource.com/setup_22.x | bash`
- Higgsfield CLI no Linux: tem versão Linux build, mesmo binary. Se falhar, fallback REST API direto

Me grita se precisar de help durante o setup.
