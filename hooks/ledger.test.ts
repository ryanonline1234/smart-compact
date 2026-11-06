import { describe, expect, test } from 'claude-code/testing'
import { askInstruction, blocks, boundarySince, carryForwardGaps, suggestBand, suggestionNote, suggestReason, unquotedAnswers, contractFrom, DEFAULT_CONTRACT, extractList, isAnswer, isCarried, isOwnText, isSettled, listItems, nextAsk, nudgeThreshold, pendingAsk, pointerLine, sectionText, withContract } from './ledger'
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

// 0.6: the captured list is held across compactions until the user answers it (docs/04's correction, the fridge case).
describe('a pending ask held across compactions', () => {
  const NOW = new Date('2026-11-06T12:00:00Z')
  const READ = (i: number) => `Read notes-${i}.md in full with the Read tool, then reply only with: read ${i}.`
  const SUMMARY_ROW = row('user', 'This session is being continued from a previous conversation that ran out of context.')
  test('what answers a decision list, and what does not', () => {
    const ask = { list: LIST_ONLY, buttons: 'Build it? Buttons: "Yes, build it", "Not now".' }
    for (const yes of ['go with recs', 'Go with recs.', 'go with your recs but skip 3', 'yes', 'Not now', 'Yes, build it', 'Build 1 and 2', 'Plan option 2', '2 and 3', '#1 only', 'no, scrape instead', 'sounds good'])
      expect([yes, isAnswer(yes, ask)]).toEqual([yes, true])
    for (const yes of ['2', '#3', 'go with 2, skip 3', '1, 3'])
      expect([yes, isAnswer(yes, ask)]).toEqual([yes, true])
    // The main session's review, 2026-11-06: a message that merely opens with a number is not a pick.
    for (const no of ['20 minutes later it failed', '3 runs per arm look thin', 'do 20 pushups first'])
      expect([no, isAnswer(no, ask)]).toEqual([no, false])
    for (const no of [READ(1), 'also check the logs first', 'now i want to make this an entire project where the screen is interactive', 'continue', '2026 numbers look off', '1.5k tokens is a lot'])
      expect([no, isAnswer(no, ask)]).toEqual([no, false])
  })
  test('a fresh, unanswered list is supplied and held, with the messages since', () => {
    const rows = [row('assistant', ASKING), row('user', READ(1)), row('user', READ(2))]
    const { use, hold } = nextAsk(rows, undefined, NOW)
    expect(use?.list).toBe(LIST_ONLY)
    expect(use?.replies).toEqual([READ(1), READ(2)])
    expect(hold).toMatchObject({ list: LIST_ONLY, replies: [READ(1), READ(2)], more: 0, capturedAt: NOW.toISOString(), lastSeen: READ(2) })
  })
  test('once the list has left the conversation, the held copy is supplied, marked as carried', () => {
    const held = { list: LIST_ONLY, replies: [READ(1)], more: 0, capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(1) }
    const { use, hold } = nextAsk([SUMMARY_ROW, row('user', READ(2)), row('assistant', 'read 2')], held, NOW)
    expect(use).toMatchObject({ list: LIST_ONLY, isCarried: true, replies: [READ(1), READ(2)] })
    expect(hold).toMatchObject({ list: LIST_ONLY, replies: [READ(1), READ(2)], capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(2) })
    const text = askInstruction(use ?? {})
    expect(text).toContain('captured before an earlier compaction')
    expect(text).toContain(LIST_ONLY)
    expect(text).toContain(`"${READ(1)}"; "${READ(2)}"`)
  })
  test('the answer is supplied once with the list, then the hold ends', () => {
    const held = { list: LIST_ONLY, replies: [READ(1)], more: 0, capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(1) }
    const { use, hold } = nextAsk([SUMMARY_ROW, row('user', 'Go with recs.'), row('assistant', 'Applied.')], held, NOW)
    expect(use?.replies).toEqual([READ(1), 'Go with recs.'])
    expect(hold).toBe(undefined)
  })
  test('messages kept verbatim after the summary are not counted twice', () => {
    const held = { list: LIST_ONLY, replies: [READ(1), READ(2)], more: 0, capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(2) }
    const rows = [SUMMARY_ROW, row('user', READ(2)), row('assistant', 'read 2'), row('user', READ(3))]
    expect(nextAsk(rows, held, NOW).hold?.replies).toEqual([READ(1), READ(2), READ(3)])
  })
  test('past three messages it keeps the first three and counts the rest', () => {
    const rows = [row('assistant', ASKING), ...[1, 2, 3, 4, 5].map(i => row('user', READ(i)))]
    expect(nextAsk(rows, undefined, NOW).use).toMatchObject({ replies: [READ(1), READ(2), READ(3)], more: 2 })
  })
  test('a newer list replaces the held one', () => {
    const held = { list: '1. Old question? Rec: old.\n2. Older? Rec: older.', replies: [], more: 0, capturedAt: '2026-11-06T11:00:00Z' }
    const { use, hold } = nextAsk([SUMMARY_ROW, row('assistant', ASKING)], held, NOW)
    expect(use?.list).toBe(LIST_ONLY)
    expect(use?.isCarried).toBe(undefined)
    expect(hold?.list).toBe(LIST_ONLY)
  })
  test('an old list that was answered is neither supplied nor held', () => {
    const rows = [row('assistant', ASKING), row('user', 'go with recs'), ...Array.from({ length: 7 }, (_, i) => row('user', `message ${i}`))]
    expect(nextAsk(rows, undefined, NOW)).toEqual({ use: undefined, hold: undefined })
  })
  test('a hold ends after seven days, or after twenty messages without an answer', () => {
    const old = { list: LIST_ONLY, replies: [], more: 0, capturedAt: '2026-10-30T11:00:00Z' }
    expect(nextAsk([SUMMARY_ROW], old, NOW)).toEqual({ use: undefined, hold: undefined })
    const busy = { list: LIST_ONLY, replies: [READ(1), READ(2), READ(3)], more: 17, capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(20) }
    expect(nextAsk([SUMMARY_ROW, row('user', 'one more thing')], busy, NOW)).toEqual({ use: undefined, hold: undefined })
  })
  // Found by the main session 2026-11-06: in the desktop app, 7 of 38 of Ryan's prompts began with a system-reminder block.
  test("a prompt that starts with system-reminder blocks is still the user's reply, stored without them", () => {
    const wrapped = '<system-reminder>\nLinked sessions now: none.\n</system-reminder>\n<system-reminder>x</system-reminder>\nGo with recs.'
    const held = { list: LIST_ONLY, replies: [READ(1)], more: 0, capturedAt: '2026-11-06T11:00:00Z', lastSeen: READ(1) }
    const { use, hold } = nextAsk([SUMMARY_ROW, row('user', wrapped)], held, NOW)
    expect(use?.replies).toEqual([READ(1), 'Go with recs.'])
    expect(use?.answer).toBe('Go with recs.')
    expect(hold).toBe(undefined)
    expect(pendingAsk([row('assistant', ASKING), row('user', wrapped)])?.answer).toBe('Go with recs.')
    expect(isOwnText('<system-reminder>only a note</system-reminder>')).toBe(false)
  })
  test('a list still in the conversation but unanswered after twenty messages is neither supplied nor held', () => {
    const rows = [row('assistant', ASKING), ...Array.from({ length: 21 }, (_, i) => row('user', READ(i + 1)))]
    expect(nextAsk(rows, undefined, NOW)).toEqual({ use: undefined, hold: undefined })
    const twenty = [row('assistant', ASKING), ...Array.from({ length: 20 }, (_, i) => row('user', READ(i + 1)))]
    expect(nextAsk(twenty, undefined, NOW).hold?.more).toBe(17)
  })
  test('commands, skill bodies and the summary itself are not replies', () => {
    const rows = [row('assistant', ASKING), row('user', '<command-name>/smart-compact:rehydrate</command-name>'), row('user', 'Base directory for this skill: /x'), SUMMARY_ROW]
    expect(nextAsk(rows, undefined, NOW).use?.replies).toEqual([])
  })
})

describe('the save suggestion in a band', () => {
  const bash = (command: string) => ({ role: 'assistant' as const, text: '', toolUses: [{ tool: 'Bash', input: { command } }] })
  const user = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
  test('a round closed since the user last spoke: a commit, merge, deploy, or a state-file write', () => {
    expect(boundarySince([user('build it'), bash('git commit -m "x"')])).toBe(true)
    // A commit before the user's latest message, which began with a system-reminder (the main session's review, 2026-11-06).
    expect(boundarySince([user('build it'), bash('git commit -m "x"'), user('<system-reminder>note</system-reminder>\nnow fix login')])).toBe(false)
    expect(boundarySince([user('build it'), { role: 'assistant', text: '', toolUses: [{ tool: 'Write', input: { file_path: '/p/HANDOFF/97_BATTERY.md' } }] }])).toBe(true)
    expect(boundarySince([bash('git commit -m "x"'), user('next one')])).toBe(false) // before the user's message
    expect(boundarySince([user('build it'), bash('git status')])).toBe(false)
  })
  test('the band stays below where Claude Code compacts on its own', () => {
    expect(suggestBand(600_000, 700_000, 967_000, 1_000_000)).toEqual({ from: 600_000, to: 700_000 })
    expect(suggestBand(600_000, 700_000, 167_000, 200_000)).toEqual({ from: 150_300, to: 150_300 })
    expect(suggestBand(600_000, 700_000, undefined, 1_000_000)).toEqual({ from: 600_000, to: 700_000 })
  })
  test('inside the band: right after a round closes, else at the top', () => {
    const band = { from: 600_000, to: 700_000 }
    expect(suggestReason(590_000, band, true)).toBe(undefined)
    expect(suggestReason(640_000, band, true)).toBe('boundary')
    expect(suggestReason(640_000, band, false)).toBe(undefined)
    expect(suggestReason(700_000, band, false)).toBe('top')
  })
  test('past the top it says so (seen 2026-11-05 at 817k: "inside the 600k–700k range")', () => {
    expect(suggestionNote(817_000, 'top', { from: 600_000, to: 700_000 })).toContain('≈817k tokens, past the top of the 600k–700k range')
  })
  test('the note asks the model to offer the save once, and not run it', () => {
    const n = suggestionNote(640_000, 'boundary', { from: 600_000, to: 700_000 }, true)
    expect(n).toContain('≈640k tokens, inside the 600k–700k range')
    expect(n).toContain('a round just closed')
    expect(n).toContain('/smart-compact:save')
    expect(n).toContain('rehydrating runs on its own afterwards')
    expect(n).toContain('do not run it yourself')
  })
})

