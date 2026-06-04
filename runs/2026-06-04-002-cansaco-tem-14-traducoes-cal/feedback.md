<!-- TEMPLATE — copiar pra runs/<run-id>/feedback.md -->
---
content_object: YYYY-MM-DD-NNN-slug
published_at: YYYY-MM-DD HH:MM
platform: instagram | linkedin | ...
post_url: https://...
---

# Feedback — [title]

## Metrics

### 24h snapshot (auto-scraped)
- Views: N
- Likes: N
- Comments: N
- Bookmarks/Saves: N
- Shares: N
- DMs: N (manual count)
- Profile visits from post: N

### 72h snapshot
- Views: N
- Likes: N
- Comments: N
- Bookmarks/Saves: N
- Shares: N
- DMs: N

## vsMedian (vs nosso histórico)
- Median Longevify (this format): X
- This post: Y
- **vsMedian: Y/X = Z**

## Verdict
- Z ≥ 2: **WINNER** → log em `stores/winners.md`, hook em `stores/hooks.md`
- 0.8 ≤ Z < 2: **NEUTRAL** → log normal
- Z < 0.8: **LOSER** → log em `stores/losers.md`, lesson em `stores/banned-patterns.md`

## Qualitative analysis

### What worked
- [specific thing]
- [specific thing]

### What didn't
- [specific thing]

### Unexpected (positive or negative)
- [...]

### Comments / DMs themes
- Theme 1: [N mentions]
- Theme 2: [N mentions]

## Hypothesis for next iteration
Se replicar, mudar:
- [...]

## Patterns to log

### To `stores/hooks.md` (if winner)
- Hook: "..."
- Pillar: N
- vsMedian: Z

### To `stores/banned-patterns.md` (if loser)
- Pattern: ...
- Hypothesis why it failed: ...

### To `stores/voice-rules.md` (if discovered)
- Rule: ...

## Updates triggered
- [ ] Updated `stores/hooks.md`
- [ ] Updated `stores/winners.md` or `stores/losers.md`
- [ ] Updated `stores/voice-rules.md`
- [ ] Updated `stores/banned-patterns.md`
- [ ] Updated `master-avoid-slop.md` (if pattern hit 2+ losses)
- [ ] Updated `pillars.md` performance table
