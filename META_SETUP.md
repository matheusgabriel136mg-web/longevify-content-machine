# Meta App Setup — Phase 5 (publish IG)

**Status:** publish.ts já está codado. Só falta você criar a app Meta + tokens + Cloudinary. ~30min de cliques.

## 30min checklist

### 1. Instagram = Business account (2min)
IG mobile → ⚙ Settings → Account → Switch to Business.

### 2. Facebook Page conectada (3min)
- Cria FB Page se não tiver: https://www.facebook.com/pages/create
- IG mobile → Settings → Account Center → Linked accounts → conecta FB

### 3. Meta App (5min)
- https://developers.facebook.com/apps → Create App → "Business" type
- Adiciona produto: **Instagram Graph API** + **Facebook Login for Business**
- App Settings → Basic → copia `App ID` e `App Secret`

### 4. Permissões / Use Case (3min)
Dashboard → Use cases → Add → "Instagram messaging and content publishing":
- `instagram_business_basic`
- `instagram_business_content_publish`
- `pages_show_list`
- `pages_read_engagement`

### 5. Long-Lived Page Access Token (5min)
```bash
cd content-machine
echo "META_APP_ID=..." >> .env
echo "META_APP_SECRET=..." >> .env
python3 scripts/instagram_publisher/get_token.py
```
- Browser abre → você autoriza
- Script imprime: PAGE_ACCESS_TOKEN (long-lived, ~60 dias) + PAGE_ID + IG_BUSINESS_ACCOUNT_ID
- Copia tudo pro `.env`

### 6. Cloudinary (10min)
- Cria conta free em https://cloudinary.com (25GB grátis)
- Dashboard → "API Environment variable" → copia o formato `cloudinary://KEY:SECRET@CLOUD`
- Cola no `.env`:
```bash
CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD
```

### 7. Validar (30s)
```bash
pnpm meta-validate
```
Esperado:
```
✅ META_PAGE_ACCESS_TOKEN — Token válido — Page: Longevify
✅ IG_BUSINESS_ACCOUNT_ID — @longevify.br (X posts)
✅ CLOUDINARY_URL — Upload teste OK → https://res.cloudinary.com/...
🎉 Tudo pronto.
```

### 8. Primeiro post (10s)
```bash
pnpm publish --run 2026-05-14-001-como-funciona-carousel --dry-run   # confere o que vai postar
pnpm publish --run 2026-05-14-001-como-funciona-carousel              # vai pro IG
```

## Variáveis finais no .env

```bash
# Meta Graph API
META_APP_ID=...
META_APP_SECRET=...
META_PAGE_ACCESS_TOKEN=...
IG_BUSINESS_ACCOUNT_ID=...

# Cloudinary (URL pública obrigatória pra Graph API)
CLOUDINARY_URL=cloudinary://...
```

## Quando renovar
- **Cloudinary**: nunca (free 25GB)
- **Page Access Token**: a cada 60 dias rode `get_token.py` de novo
- **IG ID + Page ID**: nunca mudam
