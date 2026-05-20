# Instagram Stories Publisher — Setup

Publica `.mp4` direto no Stories da Longevify via Instagram Graph API.

## Pré-requisitos (uma vez)

### 1. Conta IG = Business ou Creator
IG mobile → ⚙ Settings → Account → Switch account type → Business.

### 2. Página Facebook conectada à conta IG
- Cria uma FB Page (https://www.facebook.com/pages/create) se não tiver.
- IG mobile → Settings → Account Center → Linked accounts → Facebook → conecta.

### 3. App no Meta for Developers
1. https://developers.facebook.com/apps → **Create App** → "Business"
2. Adiciona produto: **Instagram Graph API** (e **Facebook Login for Business**)
3. App Settings → Basic → copia **App ID** e **App Secret**

### 4. Permissões do App (Use Case)
No app dashboard → Use cases → Add → **"Instagram messaging and content publishing"** → habilita scopes:
- `instagram_business_basic`
- `instagram_business_content_publish`
- `pages_show_list`
- `pages_read_engagement`

### 5. Long-Lived Page Access Token
Executa `python3 get_token.py` (script abaixo) que:
1. Abre browser → você autoriza com sua conta
2. Captura User Token short-lived
3. Troca por Long-Lived (60 dias)
4. Lista suas Pages → você escolhe
5. Salva Page Access Token (nunca expira) + Page ID + IG Business Account ID em `.env`

### 6. Hosting de vídeo (para a URL pública)
Graph API exige que o vídeo esteja em URL HTTPS pública. Opções:

- **a. Cloudinary** (free 25GB, recomendado) — `CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME`
- **b. AWS S3 + CloudFront** — `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **c. ngrok local** (mais rápido pra testar) — `brew install ngrok` + auth token gratuito

## Variáveis de ambiente (.env)

```bash
# Meta Graph API
META_APP_ID=...
META_APP_SECRET=...
META_PAGE_ACCESS_TOKEN=...   # Long-lived, não expira
IG_BUSINESS_ACCOUNT_ID=...   # 17-digit ID

# Hosting (escolha um)
CLOUDINARY_URL=cloudinary://...
# ou
S3_BUCKET=...
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# ou
NGROK_AUTHTOKEN=...
```

## Uso

```bash
python3 publish_story.py path/to/video.mp4
```

Saída esperada:
```
✓ Uploaded to https://res.cloudinary.com/.../video.mp4
✓ Container created (id=18001234)
✓ Container ready (status=FINISHED)
✓ Published as Story (media_id=17900000)
```
