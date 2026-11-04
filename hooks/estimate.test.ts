import { describe, expect, test } from 'claude-code/testing'
import { estimateDetails, estimateLine, estimateOf, fmtK, lastEntriesRange, measureTarget, parseCheckpoint, parseTokens, reattachedFromTranscript, readTarget, sectionRange, sliceLines, tokensOf } from './estimate'
import type { Measured } from './estimate'
import { CHECKPOINT } from './test-fixtures'


describe('parsing', () => {
  test('token cells', () => {
    expect(parseTokens('2k')).toBe(2000)
    expect(parseTokens('1.5k')).toBe(1500)
    expect(parseTokens('~800')).toBe(800)
    expect(parseTokens('2,000')).toBe(2000)
    expect(parseTokens('150k tokens')).toBe(150_000)
    expect(parseTokens('—')).toBe(undefined)
  })
  test('the checkpoint frontmatter and §6 table', () => {
    const m = parseCheckpoint(CHECKPOINT)
    expect(m.budget).toBe(150_000)
    expect(m.cwd).toBe('/Users/x/proj')
    expect(m.items.length).toBe(5)
    expect(m.items[0]).toEqual({ action: 'Read', target: 'src/auth.ts:2-3', estTokens: 2000, why: 'active edit site' })
    expect(m.items[3]?.estTokens).toBe(800)
  })
  test('a checkpoint with no manifest parses to no items', () => {
    expect(parseCheckpoint('---\nrebuild_budget: 100k\n---\n## 1. Task state\n').items).toEqual([])
  })
  test('read targets resolve against cwd and home, with ranges', () => {
    expect(readTarget('src/a.ts:80-240', '/p', '/h')).toEqual({ path: '/p/src/a.ts', start: 80, end: 240 })
    expect(readTarget('/abs/b.md', '/p', '/h')).toEqual({ path: '/abs/b.md', start: undefined, end: undefined })
    expect(readTarget('~/notes.md:5', '/p', '/h')).toEqual({ path: '/h/notes.md', start: 5, end: 5 })
    expect(readTarget('src/a.ts', undefined, '/h')).toBe(undefined)
  })
})

describe('measuring', () => {
  test('a range picks its lines; no range stops at the Read default of 2000', () => {
    expect(sliceLines('a\nbb\nccc\ndddd', 2, 3)).toEqual({ chars: 7, lines: 2 })
    const long = Array.from({ length: 2500 }, () => 'x').join('\n')
    expect(sliceLines(long).lines).toBe(2000)
  })
  test('prose, code and CJK divisors include the line-number prefix', () => {
    // Measured divisors: prose 2.73, code 2.49 chars/token; a 1-line file adds a 2-char "1\t" prefix.
    expect(tokensOf('a.md', 271, 1, 'hello')).toBe(100) // (271 + 2) / 2.73
    expect(tokensOf('a.ts', 247, 1, 'const x')).toBe(100) // (247 + 2) / 2.49
    expect(tokensOf('a.txt', 98, 1, '中文中文中文中文')).toBe(100) // (98 + 2) / 1.0, unmeasured
    // The calibration file docs-prose.md: 19,943 chars, 233 lines, 7,665 real tokens.
    expect(tokensOf('d.md', 19_943, 233, 'x')).toBe(7647)
  })
})

describe('estimating', () => {
  const m = parseCheckpoint(CHECKPOINT)
  const measured: Measured[] = [
    { ...m.items[0]!, tokens: 2100, isMeasured: true },
    { ...m.items[1]!, tokens: 1000, isMeasured: false },
    { ...m.items[2]!, tokens: 1200, isMeasured: true },
    { ...m.items[3]!, tokens: 800, isMeasured: false },
    { ...m.items[4]!, tokens: 0, isMeasured: false, isMissing: true },
  ]
  test('totals include the checkpoint and leave out missing files', () => {
    const e = estimateOf(m, measured, 900)
    expect(e.total).toBe(900 + 2100 + 1000 + 1200 + 800)
    expect(e.reads).toEqual({ count: 2, tokens: 3300 })
    expect(e.others).toEqual({ count: 2, tokens: 1800 })
    expect(e.missing).toBe(1)
    expect(e.overBudget).toBe(0)
  })
  test('the budget stops items in manifest order', () => {
    const e = estimateOf({ ...m, budget: 3500 }, measured, 900)
    expect(e.total).toBe(900 + 2100) // the 1000-token command would cross 3500
    expect(e.overBudget).toBe(3) // rehydrate stops there: the command, STATE.md, and the smaller search after
  })
  test('the summary sentence and the transcript lines', () => {
    const e = estimateOf(m, measured, 900)
    expect(fmtK(2140)).toBe('2.1k')
    expect(fmtK(38_400)).toBe('38k')
    expect(estimateLine(e)).toBe('Rehydrate estimate at save: up to ≈6.0k tokens (2 file reads ≈3.3k measured; 2 commands/searches ≈1.8k estimated; checkpoint ≈0.9k); less for files compaction puts back.')
    const lines = estimateDetails(e, 21_000).join('\n')
    expect(lines).toContain('Rehydrate would add ≈6.0k tokens (→ ≈27k), measured at save, budget 150k:')
    expect(lines).toContain('files: 2 ≈3.3k measured — src/auth.ts:2-3 2.1k (active edit site); docs/STATE.md 1.2k (project state)')
    expect(lines).toContain('1 file missing at save')
  })
  test('files compaction put back cost nothing and are named', () => {
    const withPaths = measured.map((x, i) => ({ ...x, path: ['/p/src/auth.ts', undefined, '/p/docs/STATE.md', undefined, '/p/src/gone.ts'][i] }))
    const e = estimateOf(m, withPaths, 900, new Set(['/p/docs/STATE.md', '/ck.md']), '/ck.md')
    expect(e.total).toBe(2100 + 1000 + 800) // STATE.md and the checkpoint are already back
    expect(e.back).toEqual(['docs/STATE.md'])
    expect(e.isCheckpointBack).toBe(true)
    const lines = estimateDetails(e).join('\n')
    expect(lines).toContain('already back after compaction, so skipped: docs/STATE.md')
    expect(lines).toContain('checkpoint itself: already back')
    expect(lines).not.toContain('less if compaction')
  })
  test('re-attached files are the file attachment rows after the last compact boundary', () => {
    const row = (o: object) => JSON.stringify(o)
    const jsonl = [
      row({ type: 'system', subtype: 'compact_boundary' }),
      row({ type: 'attachment', attachment: { type: 'file', filename: '/p/old.md' } }),
      row({ type: 'user', message: { role: 'user', content: 'later work' } }),
      row({ type: 'system', subtype: 'compact_boundary' }),
      row({ type: 'user', message: { role: 'user', content: 'This session is being continued' } }),
      row({ type: 'attachment', attachment: { type: 'file', filename: '/p/docs/STATE.md' } }),
      row({ type: 'attachment', attachment: { type: 'compact_file_reference', filename: '/p/src/big.ts' } }),
      '{"type":"attachment","attach', // a partial last line
    ].join('\n')
    expect(reattachedFromTranscript(jsonl)).toEqual(['/p/docs/STATE.md'])
    expect(reattachedFromTranscript('no boundary here')).toEqual([])
  })
})

describe('long-horizon targets', () => {
  const STATE = ['# STATE', 'Updated: today', 'old history line', '## Where things stand', 'a', '### detail', 'b', '## Next action (one step)', 'Run the gate.', '## Open questions for Ryan', '1. q?'].join('\n')
  const LOG = ['# Decisions', '## 2026-11-01 — one', 'x', '## 2026-11-02 — two', 'y', '## 2026-11-03 — three', 'z'].join('\n')
  test('a #section or #last N target resolves against the project root', () => {
    expect(readTarget('STATE.md#Next action', '/p', '/h')).toEqual({ path: '/p/STATE.md', start: undefined, end: undefined, section: 'Next action', lastN: undefined })
    expect(readTarget('DECISIONS.md#last 3', '/p', '/h')).toEqual({ path: '/p/DECISIONS.md', start: undefined, end: undefined, section: undefined, lastN: 3 })
    expect(readTarget('src/a.ts:5-9', '/p', '/h')?.start).toBe(5)
  })
  test('a section runs to the next heading of its level, subsections included', () => {
    expect(sectionRange(STATE, 'Where things stand')).toEqual({ from: 3, to: 7 })
    expect(sectionRange(STATE, 'next action')).toEqual({ from: 7, to: 9 })
    expect(sectionRange(STATE, 'nowhere')).toBe(undefined)
  })
  test('the last N entries of an append-only log', () => {
    expect(lastEntriesRange(LOG, 2)).toEqual({ from: 3, to: 7 })
    expect(lastEntriesRange(LOG, 9)).toEqual({ from: 1, to: 7 })
  })
  test('measuring a section costs only its lines; a missing section is not found', () => {
    const t = readTarget('STATE.md#Next action', '/p', undefined)!
    expect(measureTarget(STATE, t)).toEqual({ chars: 'Next action (one step)'.length + 4 + 'Run the gate.'.length + 1, lines: 2, found: true })
    expect(measureTarget(STATE, readTarget('STATE.md#Gone', '/p', undefined)!).found).toBe(false)
  })
  test('project_root and previous parse, and the manifest is found by title under any number', () => {
    const md = ['---', 'cwd: /', 'project_root: /Users/x/proj', 'previous: /ck/prev.ckpt.md', 'rebuild_budget: 150k', '---', '## 7. Rehydration manifest', '| # | action | target | anchor | ~tokens | why |', '|---|---|---|---|---|---|', '| 1 | Read | STATE.md#Next action | — | 1k | next step |'].join('\n')
    const m = parseCheckpoint(md)
    expect(m.projectRoot).toBe('/Users/x/proj')
    expect(m.previous).toBe('/ck/prev.ckpt.md')
    expect(m.items[0]?.target).toBe('STATE.md#Next action')
    expect(parseCheckpoint(md.replace('previous: /ck/prev.ckpt.md', 'previous: none')).previous).toBe(undefined)
  })
})

