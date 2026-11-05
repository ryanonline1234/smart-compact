import { describe, expect, test } from 'claude-code/testing'
import { autoName, carryDropped, composeCheckpoint, droppedItems, dropMissingTargets, editedFilesOf, fallbackCheckpoint, forkPrompt, gapAppendix, newestCheckpoint, projectDirGuess, recentFilesOf, stampOf, writeStepsFrom } from './autockpt'
import type { AutoInput } from './autockpt'
import { carryForwardGaps } from './ledger'
import { ASKING, AUTO_PREVIOUS } from './test-fixtures'

const rows = [
  { role: 'user' as const, text: 'Fix the login bug. From now on, never deploy without asking.', toolUses: [] },
  { role: 'assistant' as const, text: 'Reading.', toolUses: [{ tool: 'Read', input: { file_path: '/Users/x/proj/src/auth.ts' } }, { tool: 'Read', input: { file_path: '/Users/x/.claude/memory/x.md' } }] },
  { role: 'assistant' as const, text: ASKING, toolUses: [{ tool: 'Edit', input: { file_path: '/Users/x/proj/src/login.ts' } }] },
  { role: 'user' as const, text: 'go with recs, but no deploy yet', toolUses: [] },
]

const input = (over: Partial<AutoInput> = {}): AutoInput => ({
  path: '/Users/x/.claude/checkpoints/-Users-x-proj/20261104T230000Z-auto.ckpt.md',
  createdAt: '2026-11-04T23:00:00Z',
  trigger: 'auto',
  facts: {
    projectRoot: '/Users/x/proj',
    cwd: '/',
    git: { branch: 'main', head: 'abc1234', isDirty: true, status: ' M src/login.ts', log: 'abc1234 fix: login' },
    checkpointDir: '/Users/x/.claude/checkpoints/-Users-x-proj',
    listing: ['20261104T120000Z-login.ckpt.md'],
    state: { path: '/Users/x/proj/STATE.md', next: 'Ship the login fix.', open: '1. Deploy? Rec: yes.' },
    decisions: { path: '/Users/x/proj/DECISIONS.md', headings: ['2026-11-03 — keep sessions in cookies'] },
    handoff: 'HANDOFF/07_LOGIN.md',
    recentFiles: ['/Users/x/proj/src/login.ts', '/Users/x/proj/src/auth.ts'],
  },
  previous: { path: '/Users/x/.claude/checkpoints/-Users-x-proj/20261104T120000Z-login.ckpt.md', text: AUTO_PREVIOUS },
  ask: { list: '1. **Deploy main now?** Rec: yes.', answer: 'go with recs, but no deploy yet' },
  template: '# Checkpoint template\n## 1. Standing rules',
  writeSteps: '3. **Write the checkpoint** to `$CKPT` following TEMPLATE.md',
  profileSave: '- prefix git with DEVELOPER_DIR',
  transcriptDir: '~/.claude/projects/-/',
  ...over,
})

describe('names and the project', () => {
  test('a checkpoint name the save skill and rehydrate both accept', () => {
    expect(stampOf('2026-11-04T23:00:00Z')).toBe('20261104T230000Z')
    expect(autoName('2026-11-04T23:00:00.123Z')).toBe('20261104T230000Z-auto.ckpt.md')
    expect(newestCheckpoint(['20261104T120000Z-a.ckpt.md', 'notes.md', '20261104T230000Z-auto.ckpt.md'])).toBe('20261104T230000Z-auto.ckpt.md')
  })
  test('files the main loop touched, newest first; their directory finds the project, not ~/.claude', () => {
    const files = recentFilesOf(rows)
    expect(files).toEqual(['/Users/x/proj/src/login.ts', '/Users/x/.claude/memory/x.md', '/Users/x/proj/src/auth.ts'])
    expect(projectDirGuess(files)).toBe('/Users/x/proj/src')
    expect(projectDirGuess([])).toBe(undefined)
  })
  test('edited files only, newest first: reads do not count', () => {
    expect(editedFilesOf(rows)).toEqual(['/Users/x/proj/src/login.ts'])
  })
  test("the save skill's own write step is cut from its SKILL.md", () => {
    const skill = '2. **Paths.** x\n3. **Write the checkpoint** to `$CKPT`:\n   - rules first\n4. **Prune**, keeping'
    expect(writeStepsFrom(skill)).toBe('3. **Write the checkpoint** to `$CKPT`:\n   - rules first')
  })
})

describe('the fork prompt', () => {
  test("carries the save's rules, the template, the profile, the previous checkpoint, the pending ask and the disk facts", () => {
    const p = forkPrompt(input())
    expect(p).toContain('not the user')
    expect(p).toContain('no tools')
    expect(p).toContain('3. **Write the checkpoint**')
    expect(p).toContain('# Checkpoint template')
    expect(p).toContain('prefix git with DEVELOPER_DIR')
    expect(p).toContain(AUTO_PREVIOUS)
    expect(p).toContain('1. **Deploy main now?** Rec: yes.')
    expect(p).toContain('go with recs, but no deploy yet')
    expect(p).toContain('git status --short:\n M src/login.ts')
    expect(p).toContain('"Next action":\nShip the login fix.')
    expect(p).toContain('newest handoff: HANDOFF/07_LOGIN.md')
    expect(p).toContain('previous: /Users/x/.claude/checkpoints/-Users-x-proj/20261104T120000Z-login.ckpt.md')
  })
  test('with no previous checkpoint it says so', () => {
    expect(forkPrompt(input({ previous: undefined }))).toContain('There is no previous checkpoint')
  })
})

const WRITTEN = `\`\`\`markdown
---
created: 1999-01-01T00:00:00Z
iteration: HANDOFF/07 (next free 08)
next_action: Ship the login fix
---

## 1. Standing rules
- Never deploy without asking (stated 2026-11-04, scope: project)
- Claude tests its own work (stated 2026-10-29, scope: always)

## 2. Open decisions
1. Deploy main now? Rec: yes.

## 3. Task state
Goal: fix login.

## 7. Rehydration manifest

| # | action | target | anchor | ~tokens | why |
|---|--------|--------|--------|---------|-----|
| 1 | Read | src/login.ts | — | 1k | edit site |
| 2 | Read | src/gone.ts | — | 1k | deleted |
\`\`\``

describe("the writer's answer", () => {
  test("fences stripped; the plugin's facts replace the frontmatter, the writer's iteration and next action kept", () => {
    const out = composeCheckpoint(WRITTEN, input(), 'fork') ?? ''
    expect(out.startsWith('---\ncreated: 2026-11-04T23:00:00Z\n')).toBe(true)
    expect(out).toContain('project_root: /Users/x/proj')
    expect(out).toContain('git: main @ abc1234, dirty')
    expect(out).toContain('iteration: HANDOFF/07 (next free 08)')
    expect(out).toContain('next_action: Ship the login fix')
    expect(out).toContain('written_by: fork')
    expect(out).not.toContain('1999-01-01')
    expect(out).toContain('## 1. Standing rules\n- Never deploy')
  })
  test('an answer that is not a checkpoint is refused', () => {
    expect(composeCheckpoint('Sure! Here is a summary of the work.', input(), 'fork')).toBe(undefined)
  })
  test('what the writer dropped is found whole, and carried verbatim as a last resort', () => {
    const out = composeCheckpoint(WRITTEN, input(), 'fork') ?? ''
    const dropped = droppedItems(AUTO_PREVIOUS, out)
    expect(dropped.rules).toEqual(['Push means production: ask before any push (stated 2026-10-20, scope: always)'])
    expect(dropped.decisions).toEqual(['Use the supplier API or scrape the price pages? Options: API, scrape. Rec: API.'])
    const repaired = carryDropped(out, dropped)
    expect(repaired).toContain('- carried by the plugin (the writer dropped it): Push means production')
    expect(carryForwardGaps(AUTO_PREVIOUS, repaired)).toEqual({ rules: [], decisions: [] })
    // carried into its own section, before the next heading
    expect(repaired.indexOf('carried by the plugin (the writer dropped it): Push')).toBeLessThan(repaired.indexOf('## 2. Open decisions'))
  })
  test('manifest rows whose target is not on disk are dropped, and named', () => {
    const out = dropMissingTargets(composeCheckpoint(WRITTEN, input(), 'fork') ?? '', ['src/gone.ts'])
    expect(out).toContain('| 1 | Read | src/login.ts |')
    expect(out).not.toContain('| 2 | Read | src/gone.ts |')
    expect(out).toContain('Dropped by the plugin, not on disk: src/gone.ts.')
  })
})

describe('without a model', () => {
  test("the plugin's own checkpoint carries the previous rules and decisions, the pending ask, the user's words and a manifest", () => {
    const out = fallbackCheckpoint(input(), rows, 'the fork did not answer: nothing-to-fork')
    expect(out).toContain('written_by: plugin (no model: the fork did not answer: nothing-to-fork)')
    expect(out).toContain('Push means production: ask before any push')
    expect(out).toContain('Use the supplier API or scrape the price pages?')
    expect(out).toContain('1. **Deploy main now?** Rec: yes.')
    expect(out).toContain('> go with recs, but no deploy yet')
    expect(out).toContain('| 1 | Read | STATE.md#Next action |')
    expect(out).toContain('| Read | src/login.ts |')
    expect(out).not.toContain('memory/x.md')
    expect(carryForwardGaps(AUTO_PREVIOUS, out)).toEqual({ rules: [], decisions: [] })
  })
  test('a precomputed checkpoint gets what the user wrote after it, verbatim', () => {
    expect(gapAppendix(rows, 3)).toContain('> go with recs, but no deploy yet')
    expect(gapAppendix(rows, 4)).toBe(undefined)
  })
})
