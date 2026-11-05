import { describe, expect, test } from 'claude-code/testing'
import { askInstruction, blocks, carryForwardGaps, unquotedAnswers, contractFrom, DEFAULT_CONTRACT, extractList, isCarried, isSettled, listItems, nudgeThreshold, pendingAsk, pointerLine, sectionText, withContract } from './ledger'
import { ASKING } from './test-fixtures'

const PREVIOUS = `---
created: 2026-11-04T10:00:00Z
project_root: /Users/x/proj
---

## 1. Standing rules
- Claude tests its own work; never ask Ryan to test (stated 2026-10-29, scope: project)
- Push means production: ask before any push (stated 2026-10-20, scope: always)
- retired: keep the old CLI flags (superseded 2026-11-01)

## 2. Open decisions
1. Use scikit-fem for the load test? Options: scikit-fem, CalculiX. Rec: scikit-fem.
2. answered: deploy main now? Rec yes. Ryan: "go with recs"
3. Five-brief measurement round next? Rec: yes, after the merge.
   Needs the gate green on main first.

## 3. Task state
Goal: load test.
`

describe('sections and items', () => {
  test('a section runs to the next heading of its level', () => {
    expect(sectionText(PREVIOUS, 'standing rules')?.split('\n').length).toBe(3)
    expect(sectionText(PREVIOUS, 'missing')).toBe(undefined)
  })
  test('list items keep their continuation lines and skip "none"', () => {
    const items = listItems(PREVIOUS, 'open decisions')
    expect(items.length).toBe(3)
    expect(items[2]).toBe('Five-brief measurement round next? Rec: yes, after the merge. Needs the gate green on main first.')
    expect(listItems('## Standing rules\n- none\n', 'standing rules')).toEqual([])
  })
  test('settled items: retired, answered, superseded, struck through', () => {
    expect(isSettled('retired: keep the old CLI flags')).toBe(true)
    expect(isSettled('answered: deploy main now?')).toBe(true)
    expect(isSettled('~~old rule~~')).toBe(true)
    expect(isSettled('Claude tests its own work')).toBe(false)
  })
  test('blocks join a wrapped list item into one comparable block', () => {
    expect(blocks('- one\n  two\n- three\nplain line')).toEqual(['one two', 'three', 'plain line'])
  })
})

describe('the summary contract', () => {
  test('the default, or the profile section when it has one', () => {
    expect(contractFrom(undefined)).toBe(DEFAULT_CONTRACT)
    expect(contractFrom('# profile\n## Save\n- x\n')).toBe(DEFAULT_CONTRACT)
    expect(contractFrom('## Summary contract\n- keep HANDOFF numbers\n\n## Save\n- x')).toBe('- keep HANDOFF numbers')
  })
  test('instructions, then the contract, then the pointer unless the instructions already carry one', () => {
    const pointer = pointerLine('/ck/a.ckpt.md', '2026-11-04T10:00:00Z')
    const auto = withContract(undefined, '- rule', pointer)
    expect(auto.startsWith('Long-horizon summary contract')).toBe(true)
    expect(auto).toContain('CHECKPOINT: /ck/a.ckpt.md (saved 2026-11-04T10:00:00Z')
    const save = withContract('The summary must contain, verbatim: "CHECKPOINT: /ck/b.ckpt.md."', '- rule', pointer)
    expect(save.startsWith('The summary must contain')).toBe(true)
    expect(save).not.toContain('/ck/a.ckpt.md')
  })
})

describe('carry-forward between checkpoints', () => {
  test('a reworded rule carries; a dropped rule and a dropped open decision are reported', () => {
    const next = `## 1. Standing rules
- Claude tests its own work and never asks Ryan to test it (2026-10-29, project)

## 2. Open decisions
1. Five-brief measurement round next? Rec yes, after the merge; the gate must be green on main first.
`
    const gaps = carryForwardGaps(PREVIOUS, next)
    expect(gaps.rules).toEqual(['Push means production: ask before any push (stated 2026-10-20, scope: always)'])
    expect(gaps.decisions).toEqual(['Use scikit-fem for the load test? Options: scikit-fem, CalculiX. Rec: scikit-fem.'])
  })
  test('retiring or answering by name counts as carried, and a rule may move to another section', () => {
    const next = `## 1. Standing rules
- Claude tests its own work; never ask Ryan to test
- promoted to CLAUDE.md: push means production, ask before any push

## 2. Open decisions
- answered: use scikit-fem for the load test (Ryan: "go with recs")
- retired: five-brief measurement round (folded into HANDOFF/84)
`
    expect(carryForwardGaps(PREVIOUS, next)).toEqual({ rules: [], decisions: [] })
  })
  test('a legacy checkpoint\'s "User directives" section is read as standing rules', () => {
    const legacy = '## 4. User directives this session\n- Never deploy without asking\n'
    expect(carryForwardGaps(legacy, '## 1. Standing rules\n- none\n').rules).toEqual(['Never deploy without asking'])
  })
  test('a bold question settled by name counts as carried (seen 2026-11-04: "?**" hid the end of the question)', () => {
    const item = '**Deploy main with round 5 now?** Rec: yes, but only once you have said yes to it here. Deploying is an outward action, so it waits for your word.'
    expect(isCarried(item, blocks('- answered: Deploy main with round 5 now? ("Go with recs on 1 and 3"; not run yet)'))).toBe(true)
  })
  test('matching needs most of the words, not one', () => {
    expect(isCarried('Push means production: ask before any push', ['ask Ryan about the push button colour'])).toBe(false)
  })
})

describe('only the user settles a question', () => {
  const later = (answer: string) => `## 1. Standing rules\n- Claude tests its own work\n- Push means production: ask before any push\n\n## 2. Open decisions\n${answer}\n- answered: Five-brief measurement round next? ("yes, after the merge")\n`
  test("an answer to a previous open question must quote the user's words", () => {
    expect(unquotedAnswers(PREVIOUS, later('- answered: Use scikit-fem for the load test? (Ryan approved it)'))).toEqual(['answered: Use scikit-fem for the load test? (Ryan approved it)'])
    expect(unquotedAnswers(PREVIOUS, later('- answered: Use scikit-fem for the load test? ("go with recs")'))).toEqual([])
    expect(unquotedAnswers(PREVIOUS, later("- answered: Use scikit-fem for the load test? (Ryan: 'go with recs')"))).toEqual([])
  })
  test('an older settled line it does not settle now is left alone; with no previous checkpoint, every answered line counts', () => {
    expect(unquotedAnswers(PREVIOUS, later('- answered: Use scikit-fem? ("yes")\n- answered: an old question from last week (settled)'))).toEqual([])
    expect(unquotedAnswers(undefined, '## 2. Open decisions\n- answered: Deploy now? (yes)\n')).toEqual(['answered: Deploy now? (yes)'])
  })
})

describe('when to suggest saving', () => {
  test('60% of the auto-compaction point, capped by suggestAt, or never', () => {
    expect(nudgeThreshold(0, 1_000_000, 967_000)).toBe(580_200)
    expect(nudgeThreshold(400_000, 1_000_000, 967_000)).toBe(400_000)
    expect(nudgeThreshold(400_000, 400_000)).toBe(240_000) // a small window caps the user's number
    expect(nudgeThreshold(-1, 1_000_000)).toBe(Number.POSITIVE_INFINITY)
  })
})

const LIST_ONLY = ASKING.split('\n').slice(2, 6).join('\n')
const row = (role: 'user' | 'assistant', text: string, toolUses: { tool: string; input?: Record<string, unknown> }[] = []) => ({ role, text, toolUses })

describe('pending asks', () => {
  test('the last numbered list that asks, continuation lines kept, the closing line left out', () => {
    expect(extractList(ASKING)).toBe(LIST_ONLY)
  })
  test('numbered steps that ask nothing are not a pending ask', () => {
    expect(extractList('Done:\n1. Ran the tests\n2. Merged into main')).toBe(undefined)
  })
  test('of two lists, the one that asks', () => {
    expect(extractList('Done:\n1. built\n2. merged\n\nNext:\n1. Deploy? Rec: yes\n2. Push? Rec: no')).toBe('1. Deploy? Rec: yes\n2. Push? Rec: no')
  })
  test('a save-triggered compaction finds the list a turn back, with the reply', () => {
    const rows = [row('user', 'start'), row('assistant', ASKING), row('user', 'go with recs, but no deploy yet'), row('assistant', 'Checkpoint saved. Compaction is queued.')]
    expect(pendingAsk(rows)).toEqual({ list: LIST_ONLY, buttons: undefined, answer: 'go with recs, but no deploy yet' })
  })
  test("buttons from the app's next-step box", () => {
    const rows = [row('assistant', 'Built and tested.', [{ tool: 'mcp__ccd_turn__wrap_up', input: { recap: 'x', ask: 'Merge it?', actions: [{ label: 'Yes, merge' }, { label: 'Not yet' }] } }])]
    expect(pendingAsk(rows)?.buttons).toBe('Merge it? Buttons: "Yes, merge", "Not yet".')
  })
  test('nothing older than six user messages counts', () => {
    const rows = [row('assistant', ASKING), ...Array.from({ length: 7 }, (_, i) => row('user', `message ${i}`))]
    expect(pendingAsk(rows)).toBe(undefined)
  })
  test('the instruction quotes the list and says whether it was answered', () => {
    const open = askInstruction({ list: LIST_ONLY })
    expect(open).toContain(LIST_ONLY)
    expect(open.endsWith('Not answered yet.')).toBe(true)
    expect(askInstruction({ list: LIST_ONLY, answer: 'go with recs' })).toContain('The user\'s reply, verbatim: "go with recs"')
  })
})
