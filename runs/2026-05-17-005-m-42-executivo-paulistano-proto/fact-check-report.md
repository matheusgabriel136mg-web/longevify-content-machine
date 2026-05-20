---
fact_check_verdict: reject
total_claims: 8
high_risk: 2
medium_risk: 4
low_risk: 2
checked_at: 2026-05-17T23:15:11.256Z
---

# Fact-Check Report — 2026-05-17-005-m-42-executivo-paulistano-proto

**Verdict: REJECT**

Peça tem erro técnico grave nas unidades do biomarcador central (cortisol salivar reportado em μg/dL — unidade de sérico, não salivar; faixas numéricas inconsistentes com matriz declarada). Além disso, a dicotomia 'faixa lab vs faixa funcional' é apresentada como fato estabelecido quando é construção de medicina funcional sem consenso. 6 dos 8 claims precisam revisão. Recomendo retrabalho do slide 3 com verificação da fonte primária (Adam & Kumari 2009) antes de re-submeter.

## Claims auditados


### 🔴 REMOVE · evidência 2/5
> "Cortisol salivar — ritmo 24h: Acordar 7–28 (faixa lab), 13–18 (faixa funcional); 22h <7,5 (lab), <3 (funcional) μg/dL"

- **Tipo**: numeric
- **Reasoning**: Unidades incorretas — cortisol salivar é medido em ng/mL ou nmol/L, não μg/dL (que é sérico). Além disso, valores 7–28 μg/dL ao acordar são plausíveis para cortisol SÉRICO matinal, não salivar. Erro técnico grave num claim numérico central da peça.
- **Fontes encontradas**: Adam EK, Kumari M. Psychoneuroendocrinology, 2009 (citada no draft, não verificada no proof bank)
- **Sugestão reescrita**: 
  > Validar fonte primária (Adam & Kumari 2009 ou ref equivalente) e corrigir matriz/unidade. Se for salivar: ng/mL. Se for sérico: manter μg/dL mas remover o rótulo 'salivar'. Faixas 'funcionais' (13–18 acordar, <3 às 22h) precisam citação rastreável — termo 'faixa funcional' vem de functional medicine e não tem consenso endócrino formal; suavizar para 'faixa de referência otimizada' com fonte ou remover a coluna.


### 🟡 CITE-SOURCE · evidência 3/5
> "Cortisol ao acordar: 22,4 → 15,8 em 60 dias. Cortisol 22h: 6,1 → 2,4"

- **Tipo**: numeric
- **Reasoning**: Resultado de caso individual (N=1) anonimizado. Aceitável como case report editorial desde que o disclaimer 'caso anonimizado, cada protocolo é individual' esteja preservado, mas as unidades têm o mesmo problema do claim anterior.
- **Fontes**: nenhuma encontrada no proof-bank/PubMed
- **Sugestão reescrita**: 
  > Manter os números mas alinhar unidades com o slide 3 corrigido. Reforçar disclaimer de caso individual já presente na caption.


### 🟡 CITE-SOURCE · evidência 3/5
> "O exame anual mede uma vez, em jejum, pela manhã. Não captura o ritmo. E é no ritmo que mora a fadiga."

- **Tipo**: causal
- **Reasoning**: Associação entre achatamento da curva diurna de cortisol e fadiga/burnout tem suporte observacional consistente, mas 'mora a fadiga' é causal forte. Soften e atribui.
- **Fontes encontradas**: Adam EK, Kumari M. Psychoneuroendocrinology, 2009 (cortisol diurnal slope e fadiga/saúde)
- **Sugestão reescrita**: 
  > 'O exame anual mede uma vez, em jejum. Não captura a curva diurna — e o achatamento dessa curva está associado à fadiga crônica (Adam & Kumari, 2009).'


### 🟢 KEEP · evidência 3/5
> "Janela de luz solar 7h–8h, 15 min, sem óculos escuros [para reset do eixo cortisol]"

- **Tipo**: mechanism
- **Reasoning**: Exposição à luz matinal modula CAR (cortisol awakening response) e ritmo circadiano via SCN — racional mecanístico bem estabelecido, embora o protocolo específico (15 min, 7h–8h) seja heurístico.
- **Fontes**: nenhuma encontrada no proof-bank/PubMed



### 🟡 SOFTEN · evidência 2/5
> "Carga de treino reduzida em 30% nas primeiras 3 semanas [para reset do eixo]"

- **Tipo**: guideline
- **Reasoning**: Redução de carga em overreaching/HPA-axis dysfunction tem suporte em sports medicine, mas o número específico (30%, 3 semanas) é prescritivo sem ancoragem em guideline. Pode parecer protocolo médico universal.
- **Fontes**: nenhuma encontrada no proof-bank/PubMed
- **Sugestão reescrita**: 
  > 'Redução temporária de volume de treino enquanto o eixo se recupera (ajuste individualizado com profissional).'


### 🟢 KEEP · evidência 3/5
> "Última refeição 3h antes de dormir. Quarto a 19°C [para reset do eixo cortisol]"

- **Tipo**: mechanism
- **Reasoning**: Janela alimentar noturna e temperatura ambiente baixa (~18–20°C) para sono têm suporte em literatura de sono/circadiano (e.g., recomendações da AASM e estudos de TST).
- **Fontes**: nenhuma encontrada no proof-bank/PubMed



### 🟡 SOFTEN · evidência 2/5
> "Reset do eixo, não medicação do sintoma."

- **Tipo**: causal
- **Reasoning**: Implica que intervenções de estilo de vida 'resetam' o eixo HPA — racional plausível mas linguagem prescritiva demais. 'Reset' sugere mecanismo definido sem RCT confirmando reversão de disfunção HPA por esse protocolo.
- **Fontes**: nenhuma encontrada no proof-bank/PubMed
- **Sugestão reescrita**: 
  > 'Suporte ao eixo via comportamento, não supressão farmacológica do sintoma.'


### 🔴 REMOVE · evidência 1/5
> "Faixa de laboratório existe pra detectar doença. Faixa funcional existe pra detectar o ponto em que o corpo já começou a pedir socorro, mas ainda não quebrou."

- **Tipo**: comparison
- **Reasoning**: 'Faixa funcional' é construção de medicina funcional sem consenso endócrino. Apresentar como dicotomia validada ('lab = doença, funcional = pré-doença') é overclaim — pode ser interpretado como crítica indevida à medicina laboratorial padrão e promessa de detecção precoce não suportada.
- **Fontes**: nenhuma encontrada no proof-bank/PubMed
- **Sugestão reescrita**: 
  > 'Faixas de referência laboratoriais foram desenhadas para distinguir doença de não-doença. Faixas mais estreitas, usadas em medicina preventiva, buscam identificar desvios sub-clínicos — uma abordagem em discussão, não consenso.'

