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

// A previous checkpoint in today's shape (rules and decisions first), for the auto-checkpoint tests.
export const AUTO_PREVIOUS = `---
created: 2026-11-04T12:00:00Z
project_root: /Users/x/proj
previous: none
rebuild_budget: 150k
next_action: fix login
---

## 1. Standing rules
- Claude tests its own work (stated 2026-10-29, scope: always)
- Push means production: ask before any push (stated 2026-10-20, scope: always)

## 2. Open decisions
1. Deploy main now? Rec: yes.
2. Use the supplier API or scrape the price pages? Options: API, scrape. Rec: API.

## 3. Task state
Goal: fix login.

## 7. Rehydration manifest

| # | action | target | anchor | ~tokens | why |
|---|--------|--------|--------|---------|-----|
| 1 | Read | src/auth.ts | — | 1k | edit site |
`
