# Longevify Content Machine — Setup

Pipeline de geração de conteúdo (videos, covers, reels) para a Longevify.

## Pré-requisitos

Instalar uma vez:

```bash
# Node 20+ e pnpm (gestor de pacotes JS)
brew install node pnpm

# Python 3.10+ (já vem no macOS)
python3 --version

# ffmpeg (encoding de video)
brew install ffmpeg

# Higgsfield CLI (geração de imagem/video AI — Nano Banana Pro, Kling, Veo3, GPT Image 2)
npm install -g @higgsfield/cli
higgsfield auth login
```

## Setup do projeto

```bash
# 1. Descompacta o zip onde quiser
unzip longevify-content-machine.zip
cd content-machine

# 2. Instala dependências JS (pasta node_modules vai aparecer, ~6.8GB)
pnpm install

# 3. Cria seu arquivo de credenciais
cp .env.example .env
# Edita .env preenchendo as API keys (próxima seção)

# 4. Cria venv Python pra scripts de motion graphics
python3 -m venv .venv
source .venv/bin/activate
pip install Pillow requests pyngrok
```

## Credenciais necessárias (.env)

```bash
# Anthropic Claude — claude.ai/settings/keys
ANTHROPIC_API_KEY=sk-ant-...

# Apify (scraping IG) — console.apify.com/account/integrations
APIFY_API_TOKEN=apify_api_...

# Handles de IG pra monitorar
IG_HANDLE_1=superpowerapp
IG_HANDLE_2=mitohealth

# Higgsfield (image/video AI) — autenticado via CLI, não precisa colocar aqui
```

## Estrutura

```
content-machine/
├── assets/
│   ├── reels/             # Videos gerados (.mp4)
│   ├── portraits/         # Portraits AI gerados
│   ├── heart-cover/       # Capas heart variantes
│   ├── specialty-panels/  # Capa specialty panels
│   └── fonts/             # DM Sans + Playfair (Longevify brand)
├── dashboard-images/      # 167 referências SP/Mito (input)
├── dashboard-data.json    # Análise de cada post
├── dashboard.html         # Dashboard visual de seleção
├── scripts/
│   └── instagram_publisher/  # Python: publica direto no IG Stories
├── generate-brief.ts      # Gera brief criativo via Claude
├── composite.ts           # Composições de imagem
├── pipeline.ts            # Pipeline completo
└── LONGEVIFY_BRAND.md     # Tipografia, paleta, voice
```

## Comandos úteis

```bash
# Ver o dashboard de referências SP/Mito
python3 -m http.server 8080
# abre http://127.0.0.1:8080/dashboard.html

# Gerar imagem com Higgsfield (Nano Banana Pro, 4:5, 2k)
higgsfield generate create nano_banana_2 \
  --prompt "Editorial cinematic close-up..." \
  --image "dashboard-images/superpower-XYZ.jpg" \
  --aspect_ratio "4:5" \
  --resolution "2k" \
  --wait

# Gerar reel com Kling 3.0 Pro
higgsfield generate create kling3_0 \
  --prompt "Cinematic abstract motion..." \
  --start-image "path/to/frame.png" \
  --aspect_ratio "9:16" \
  --duration 5 --mode pro --wait

# Listar jobs recentes
higgsfield generate list --image --size 20
higgsfield generate list --video --size 10

# Motion graphics typewriter (Python local + ffmpeg)
.venv/bin/python /tmp/render-typewriter-story.py
ffmpeg -framerate 24 -i frames/frame_%04d.png \
  -c:v libx264 -crf 18 output.mp4

# Publicar no IG Stories (Graph API)
cd scripts/instagram_publisher
python3 get_token.py        # OAuth uma vez
python3 publish_story.py ../../assets/reels/SEU_VIDEO.mp4
```

## Fluxo típico

1. **Scraping** — Apify puxa posts do `superpowerapp` e `mitohealth` → salva em `dashboard-data.json`
2. **Análise** — Claude analisa cada post (composição, paleta, tipografia, hook) → enriquece dashboard
3. **Seleção** — abre dashboard.html no browser, escolhe posts pra reproduzir
4. **Geração de capa** — Nano Banana Pro / GPT Image 2 com prompt PT-BR + referência SP
5. **Geração de motion** — Kling/Veo3 (image-to-video) ou Python motion graphics (typewriter, glassmorphism)
6. **Composição final** — ffmpeg overlay logo Longevify + concat partes
7. **Publicação** — Instagram Graph API direto, ou AirDrop pro celular

## Custos AI (estimado)

- Higgsfield créditos: ~$0.10-$0.50 por imagem, $1-$3 por video 5s
- Anthropic: ~$0.01-$0.10 por análise de post
- Apify: $0.10 por 100 posts scrapados

## Suporte

Brand voice e regras: `LONGEVIFY_BRAND.md`
Pillars de conteúdo: `LONGEVIFY_PILLARS.md`
Workflow visual: `WORKFLOW.svg`
