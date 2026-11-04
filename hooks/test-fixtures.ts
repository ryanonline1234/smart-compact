// A checkpoint in TEMPLATE.md's shape, shared by the tests.
export const CHECKPOINT = `---
created: 2026-11-03T12:00:00Z
cwd: /Users/x/proj
git: main @ abc1234, dirty   # omit if not a repo
rebuild_budget: 150k
next_action: fix the auth bug
---

## 1. Task state
Goal: fix auth.

## 6. Rehydration manifest
Ordered; execute top-down, stop at rebuild_budget.

| # | action | target | anchor | ~tokens | why |
|---|--------|--------|--------|---------|-----|
| 1 | Read | \`src/auth.ts:2-3\` | \`login(\` | 2k | active edit site |
| 2 | Run | git log --oneline -15 && git diff --stat | — | 1k | recent motion |
| 3 | Read | docs/STATE.md | — | 1.5k | project state |
| 4 | Search | episodic-memory: "auth", this session | — | ~800 | conversation detail |
| 5 | Read | src/gone.ts | — | 3k | deleted since |
`

// A message that ends with numbered decisions and recommendations, for the pending-ask tests.
export const ASKING = [
  'Two things before I build:',
  '',
  '1. **Deploy main now?** Rec: yes.',
  '2. Use the supplier API or scrape the price pages?',
  '   Options: API, scrape. Rec: API.',
  '3. Add a cost ceiling per build? Rec: yes, 150 dollars.',
  '',
  'Say "go with recs" and I start.',
].join('\n')
