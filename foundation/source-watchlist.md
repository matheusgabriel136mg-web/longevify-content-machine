# Source Watchlist — External Signal Layer

Contas, sites e fontes monitoradas. Estes alimentam `stores/inbox.md` via Apify.

## Instagram (Apify scraper)

### Tier 1 — Diretos / referência primária (ICP overlap > 60%, copiamos angles e formato com adaptação cultural)
- **@superpowerapp** — concorrente americano, referência visual/editorial. Adaptar com cuidado cultural.
- **@mitohealth** — concorrente americano técnico, biohacker. Bom para Pilar 2 (biomarcador escondido).
- **@bryanjohnson_** — listas de protocolos longevidade em formato carrossel/texto longo. Mina de conteúdo: cada item de uma lista vira hook isolado. Tensão cultural altíssima na adaptação BR (ex.: "avoid American convenience store" → "tudo da padaria"; "coffee before noon" → café brasileiro pós-almoço; "alcohol is bad" → happy hour de quinta).

### Tier 2 — Referência indireta (ICP overlap parcial OU formato/visual ouro mas conteúdo adapta)
- **@betterbe.health** — referência brasileira que está elevando o nível local. Estudar como adaptam tom premium ao mercado BR (linguagem, sotaque editorial, ICP brasileiro). Possível fonte de aprendizado direto sobre como falar com nosso público.
- **@functionhealth** — REFERÊNCIA PRIMÁRIA de formato. Eles **diversificaram além de health-data** e isso é o moat: feed deles tem 10+ formatos recorrentes (quote cards Yung Pueblo, QUICK QUESTION series, TRUE STORY series, stat-driven, reels com caption pull-out branca, iMessage screenshots, handwritten elements, street interviews, celebrity convos, sub-brand "Long Live Moms"). Paleta SATURADA (laranja/azul/creme — não dark dominante). Tipografia mix serif+sans (eles NÃO seguem fonte única). **Branded series com badges** ("QUICK QUESTION", "TRUE STORY") cria identidade recorrente. Adaptação Longevify: criar nossos branded series equivalents — "FAIXA FUNCIONAL", "OVERHEARD NO BR", "CASO REAL" — em paleta forest+gold.
- **@thornehealth** — formato editorial **tabela de referência** (supplement timetable, pros/cons comparison) é ouro pra adaptar pro Pilar 2 (biomarcadores). Pill tags + colunas alinhadas + saveable. Paleta deles é cream/warm; nossa adaptação é forest+gold. Não competem diretamente (eles vendem supplements, nós painel), mas formato é referência primária.
- **@rerisehealth** — formato **timeline progression** (Week 6 / 14 / 52) + **transparent dosing** ("300 mg NMN") + **numbered frameworks** ("Map Pathways → Select Actives"). Ouro pra Pilar 2 mostrando evolução de biomarcador (Dia 1 → Dia 30 → Dia 90). ICP semelhante (40-65 fadiga/longevidade). Visual: clean, minimalist, generous white space. Adaptação BR: paleta forest+gold + linguagem pt-BR + biomarcadores SBC/AHA brasileiros.
- **@timeline_longevity** — **conteúdo E estética ambos ouro**. Referência dupla: scrape pra extrair tanto angles de conteúdo quanto patterns visuais. Pilar 2 + Pilar 3 friendly.
- **@hubermanlab** — autoridade científica. Headlines têm padrão "Tools and protocols for X"
- **@peterattiamd** — longevidade médica. Cuidado: muito técnico.
- **@seed** — produto diferente (probióticos), mas voz editorial e visual scientific-premium são referência ouro. Tom Mito-adjacente com polimento Aesop. Estudar copywriting deles.

### Tier 3 — Apenas ideias (NÃO copia estética)
- **@dr.longevity** — **ideias excelentes de conteúdo, estética HORRÍVEL**. Scrape só pra extrair angles/insights — visual deles NÃO serve de referência. Quando reproduzir, route obrigatório = `rewrite` (não `repurpose`), e o brief deve explicitamente proibir copiar layout visual deles.

### Tier 4 — Cultura / estética (não copia copy, captura mood visual)
- **@aesop** — fotografia editorial premium, paleta neutra
- **@equinox** — campaign style, sotaque urbano premium
- **@nasa** — para visual cinematográfico de "macro"
- **@apple** — keynote slide aesthetics

## LinkedIn (futuro)
- Longevity research labs
- Brazilian health-tech founders
- Endocrinologistas brasileiros respeitados

## Sites / blogs (RSS — futuro)
- attia.md (Peter Attia)
- hubermanlab.com
- functionhealth.com/blog
- examine.com (proof bank)
- SBC (Sociedade Brasileira de Cardiologia) — diretrizes atualizadas
- AHA (American Heart Association) — comparativo internacional

## Podcasts (transcripts pra knowledge — futuro)
- Huberman Lab
- The Drive (Attia)
- Found My Fitness (Rhonda Patrick)

## How it feeds the pipeline

1. **Apify scrape** roda diariamente (manhã)
2. Cada post novo → entrada em `stores/inbox.md` com:
   - link, screenshot, primary text, hook, format, vsMedian
3. Idea Gate decide se vira run:
   - Hook forte + alinhado a pilar → REWRITE route
   - Format inovador + adaptável → REPURPOSE route
   - Dado novo / estudo → vai pro `proof-bank.md`, não vira post imediato
4. Watchlist é atualizada quando: nova fonte de qualidade aparece, ou fonte cai em performance/qualidade

## Quality bar for adding a source

Antes de adicionar conta nova ao Tier 1/2:
- [ ] Já gerou hook que adaptamos com sucesso (vsMedian > 2x)? OU
- [ ] Tem formato visual proprietário que vale referenciar? OU
- [ ] Audiência overlap > 30% com Longevify ICP?

Sem ≥1 sim acima — não adicionar. Watchlist enxuto > watchlist inchado.
