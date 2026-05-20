# Visual Bug Patterns — known issues to check in every QA pass

> Atualizado automaticamente por visual-qa.ts. Cada padrão é uma falha real que já apareceu em algum slide.

## Pattern: typography-metadata-rendered
- **Symptom**: Texto do tipo "DM Sans Light 300, at 60% opacity 10pt" aparece literalmente desenhado no canvas.
- **Cause**: Prompt usou nomes de fonte/peso/opacity como instrução sem prefixo explícito.
- **Fix**: Adicionar ao prompt: "DO NOT append technical metadata, font names, opacity percentages, point sizes as text".

## Pattern: fake-logo-placeholder
- **Symptom**: Retângulo branco / frosted glass card desenhado onde deveria ter logo overlay.
- **Cause**: Prompt mencionou "logo" ou "watermark" sem proibir desenho.
- **Fix**: "Reserve clean black space for logo overlay. DO NOT draw any logo, badge, rectangle, frosted glass card, sticker, white box."

## Pattern: number-text-hallucination
- **Symptom**: Percentages como "70%" ou "60%" renderizados após uma palavra-chave (ex: "sensibilidade insulínica 70%").
- **Cause**: Modelo associou conceito a número, inferiu valor.
- **Fix**: "Render ONLY the words specified. Do NOT append any percentage, opacity value, or annotation."

## Pattern: visible-gutters
- **Symptom**: Grid de imagens tem linhas/espaços visíveis entre células.
- **Cause**: Default do modelo é desenhar grid com gap.
- **Fix**: "Cells must be RAZOR-FLUSH, zero gutters, zero gaps. Touching edges."

## Pattern: typography-misplacement
- **Symptom**: Numeral grande no centro-meio em vez de centro-esquerda (ou outro lugar especificado).
- **Cause**: Modelo default a centralizar.
- **Fix**: Especificar exatamente "row 2 column 1 of 3x3 grid" ou "left 30% of canvas".
