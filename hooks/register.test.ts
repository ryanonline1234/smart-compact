import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { fallbackLine, parseRequest, queuedReport, sizes, TOOL_ID } from './register'
import { estimateOf, parseCheckpoint } from './estimate'
import { ASKING, CHECKPOINT } from './test-fixtures'

const CKPT = '/Users/x/.claude/checkpoints/-Users-x-proj/20261103T120000Z-fix-auth.ckpt.md'
const INSTRUCTIONS = `The summary must contain, verbatim: "Task: fix auth. CHECKPOINT: ${CKPT}. Rehydrate from it only when the user sends /smart-compact:rehydrate."`
const CKPT2 = '/Users/x/.claude/checkpoints/-Users-x-proj/20261103T130000Z-fix-auth-later.ckpt.md'
const INSTRUCTIONS2 = `The summary must contain, verbatim: "Task: fix auth, later. CHECKPOINT: ${CKPT2}. Rehydrate from it only when the user sends /smart-compact:rehydrate."`

function turnEnd(reason: 'answer' | 'aborted' | 'refusal' | 'error', agentId?: string) {
  return { answer: 'saved', durationMs: 10, isAborted: reason === 'aborted', turnId: 't1', reason, agentId } as never
}

/** The engine beneath the plugin: records compactions and transcript lines. */
const SUMMARY = [{ role: 'user', text: 'summary', toolUses: [] }]
const FILES: Record<string, string> = {
  [CKPT]: CHECKPOINT,
  '/Users/x/proj/src/auth.ts': 'line one\nconst login = () => token\nreturn token\n',
  '/Users/x/proj/docs/STATE.md': '# State\nAuth fix in progress.\n',
  '/t/session.jsonl': [
    JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
    JSON.stringify({ type: 'attachment', attachment: { type: 'file', filename: '/Users/x/proj/docs/STATE.md' } }),
  ].join('\n'),
}

function engine(
  on: On,
  compactAnswer: object = { messages: SUMMARY, tokensBefore: 412_000, tokensAfter: 31_000 },
  fileExists = true,
  usageTokens = 1_000,
  files: Record<string, string> = FILES,
  autoAt?: number,
) {
  const compactions: { instructions?: string }[] = []
  const commands: { command: string; args: string }[] = []
  const logs: string[] = []
  const suggestions: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/x' })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('session.usage', (_, e) => {
    const breakdown = (e as { breakdown?: string } | undefined)?.breakdown === undefined ? undefined : { autoCompactThreshold: autoAt }
    return { value: { startedAt: 0, context: { tokens: usageTokens, window: 1_000_000, breakdown }, rateLimits: [] } } as never
  })
  on('prompt.suggest', (_, e) => {
    suggestions.push(e.text)
    return { isShown: true }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}) as never)
  on('tool.register', () => ({ value: { tool: TOOL_ID } }))
  on('fs.exists', () => ({ value: fileExists }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // /compact as the engine runs it: held open until the test body raises the
  // compaction it causes (a hook may only call what its module's source calls).
  const releases: (() => void)[] = []
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (e.command !== 'compact') return { value: { text: '' } } as never // a skill command: queued, nothing to hold
    return new Promise(resolve => releases.push(() => resolve({ value: { text: 'Compacted.' } } as never)))
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }) as never)
  on('session.compact', (_, e) => {
    compactions.push({ instructions: e.instructions })
    return compactAnswer as never
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  /** Finishes each /compact the plugin started: the compaction, then the command's answer. */
  async function runQueued($: { session: { compact: (a: never) => Promise<unknown> } }) {
    await clock.advance(200)
    for (const c of commands.splice(0).filter(c => c.command === 'compact')) {
      // As the engine raises it for /compact: trigger and the transcript it runs over.
      await $.session.compact({ trigger: 'manual', instructions: c.args, messages: SUMMARY } as never)
      releases.shift()?.()
    }
    await clock.settle()
  }
  return { compactions, commands, logs, clock, runQueued, suggestions }
}

describe('parseRequest', () => {
  test('accepts instructions that carry the checkpoint path', () => {
    expect(parseRequest({ instructions: INSTRUCTIONS, checkpoint: CKPT })).toEqual({ instructions: INSTRUCTIONS, checkpoint: CKPT })
  })
  test('refuses a subagent, empty text, a relative path, and a path the text omits', () => {
    expect('deny' in parseRequest({ instructions: INSTRUCTIONS, checkpoint: CKPT, agentId: 'a1' })).toBe(true)
    expect('deny' in parseRequest({ instructions: '  ', checkpoint: CKPT })).toBe(true)
    expect('deny' in parseRequest({ instructions: INSTRUCTIONS, checkpoint: 'ckpt.md' })).toBe(true)
    expect('deny' in parseRequest({ instructions: 'keep the plan', checkpoint: CKPT })).toBe(true)
  })
  test('fallback line and sizes', () => {
    expect(fallbackLine({ instructions: 'x', checkpoint: CKPT })).toBe('/compact x')
    expect(sizes({ tokensBefore: 412_000, tokensAfter: 31_000 })).toBe(' (412k → 31k tokens)')
    expect(sizes({})).toBe('')
  })
})

describe('the queued compaction', () => {
  test('runs with the instructions when the main turn ends, once', async ($, on) => {
    const { compactions, commands, logs, clock, runQueued, suggestions } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.classic.SessionStart({ source: 'startup', transcript_path: '/t/session.jsonl' } as never)
    const queued = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(queued.deny).toBe(undefined)
    expect(compactions.length).toBe(0) // nothing runs mid-turn

    await $.turn.complete(turnEnd('answer'))
    expect(commands.length).toBe(0) // not from inside the hook the turn waits on
    await clock.advance(200)
    // The estimate was measured at queue time and rides into the summary.
    expect(commands.length).toBe(1)
    expect(commands[0]?.args.startsWith(INSTRUCTIONS)).toBe(true)
    expect(commands[0]?.args).toContain('Also state in the summary, verbatim: "Rehydrate estimate at save:')
    expect(commands[0]?.args).toContain('2 file reads')
    await runQueued($ as never)
    expect(compactions.length).toBe(1)
    const shown = logs.join('\n')
    expect(shown).toContain('already back after compaction, so skipped: docs/STATE.md')
    expect(shown).toContain('compacted (412k → 31k tokens); the system prompt and tools come on top.')
    expect(shown).toContain('Rehydrate would add ≈')
    expect(shown).toContain('src/auth.ts:2-3')
    expect(shown).toContain('1 file missing at save') // src/gone.ts
    expect(shown).toContain('/smart-compact:rehydrate')
    expect(suggestions).toEqual(['/smart-compact:rehydrate'])

    await $.turn.complete(turnEnd('answer'))
    await runQueued($ as never)
    expect(compactions.length).toBe(1) // consumed: the next turn does not compact again
  })

  test('a save while the first compaction waits answers "already queued" and compacts once', async ($, on) => {
    const { compactions, commands, clock, runQueued } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands.length).toBe(1) // handed to the engine, which holds it until the session is idle
    // A /smart-compact:save typed during the first save runs before that /compact (seen 2026-11-04).
    const again = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(again.deny).toBe(undefined)
    expect(JSON.stringify(again)).toContain('Already queued: a compaction with this checkpoint')
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands.length).toBe(1)
    await runQueued($ as never)
    expect(compactions.length).toBe(1)
    await $.turn.complete(turnEnd('answer'))
    await runQueued($ as never)
    expect(compactions.length).toBe(1)
  })
  test('a newer checkpoint saved while the compaction waits rides on it, not on a second one', async ($, on) => {
    const { compactions, logs, clock, runQueued } = engine(on, undefined, true, 1_000, { ...FILES, [CKPT2]: CHECKPOINT })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    const newer = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS2, checkpoint: CKPT2 } as never)
    expect(JSON.stringify(newer)).toContain(`Already queued: a compaction queued in an earlier turn (checkpoint ${CKPT})`)
    await $.turn.complete(turnEnd('answer'))
    await runQueued($ as never)
    expect(compactions.length).toBe(1)
    expect(compactions[0]?.instructions).toContain(`CHECKPOINT: ${CKPT2}.`)
    expect(compactions[0]?.instructions).not.toContain(`CHECKPOINT: ${CKPT}.`)
    expect(logs.join('\n')).toContain(`Checkpoint: ${CKPT2}`)
  })
  test('a /compact that never runs stops blocking saves after three turns', async ($, on) => {
    const { commands, logs, clock } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    for (let i = 0; i < 3; i++) await $.turn.complete(turnEnd('answer')) // the engine never runs it
    expect(logs.join('\n')).toContain('the queued /compact has not run after 3 turns, so it counts as dropped')
    const later = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(JSON.stringify(later)).toContain('Queued. Claude Code compacts')
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands.filter(c => c.command === 'compact').length).toBe(2)
  })
  test('a subagent ending does not consume it; the main turn does', async ($, on) => {
    const { compactions, runQueued } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer', 'agent-1'))
    await runQueued($ as never)
    expect(compactions.length).toBe(0)
    await $.turn.complete(turnEnd('answer'))
    await runQueued($ as never)
    expect(compactions.length).toBe(1)
  })

  test('an interrupted turn compacts nothing and prints the paste line', async ($, on) => {
    const { compactions, logs, clock } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('aborted'))
    await clock.advance(200)
    expect(compactions.length).toBe(0)
    expect(logs.join('\n')).toContain(`/compact ${INSTRUCTIONS}`)
  })

  test('a vetoed compaction prints the paste line', async ($, on) => {
    const { logs, runQueued } = engine(on, { skip: 'blocked by a PreCompact hook' })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await runQueued($ as never)
    expect(logs.join('\n')).toContain('compaction skipped (blocked by a PreCompact hook)')
    expect(logs.join('\n')).toContain(`/compact ${INSTRUCTIONS}`)
  })

  test('a missing checkpoint file is refused and queues nothing', async ($, on) => {
    const { compactions, clock } = engine(on, undefined, false)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    const refused = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(String(refused.deny ?? refused.text)).toContain('No file at')
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(compactions.length).toBe(0)
  })

  test('an unreadable manifest still compacts, with the plain instructions', async ($, on) => {
    const { commands, logs, clock, runQueued } = engine(on, undefined, true, 1_000, {})
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands.map(c => c.args)).toEqual([INSTRUCTIONS])
    await runQueued($ as never)
    expect(logs.join('\n')).toContain('compacted')
    expect(logs.join('\n')).not.toContain('Rehydrate would add')
  })
})

describe('what the queue tool tells the model', () => {
  const m = parseCheckpoint(CHECKPOINT)
  test('the measured estimate, and the targets it could not count', () => {
    const measured = m.items.map((x, i) => ({ ...x, tokens: [2100, 1000, 1200, 800, 0][i] ?? 0, isMeasured: i !== 1 && i !== 3, isMissing: i === 4 }))
    const report = queuedReport(estimateOf({ ...m, budget: 3500 }, measured, 900))
    expect(report).toContain('Measured: Rehydrate estimate at save: up to ≈3.0k tokens')
    expect(report).toContain('Not found on disk, so rehydrate cannot read them: src/gone.ts.')
    expect(report).toContain('Past rebuild_budget, so rehydrate stops before them: git log --oneline -15 && git diff --stat, docs/STATE.md')
    expect(report.endsWith('anything done after the save is not in the checkpoint.')).toBe(true)
  })
  test('without a readable manifest it only confirms the queue', () => {
    expect(queuedReport(undefined)).toBe(
      'Queued. Claude Code compacts this conversation as soon as this turn ends, with these instructions. ' +
        'Finish the turn now with the SAVE report; anything done after the save is not in the checkpoint.',
    )
  })
})

describe('the save suggestion', () => {
  test('past 60% of the window it suggests /smart-compact:save once', async ($, on) => {
    const { logs, suggestions } = engine(on, undefined, true, 640_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    await $.turn.complete(turnEnd('answer'))
    expect(suggestions).toEqual(['/smart-compact:save'])
    expect(logs.join('\n')).toContain('context is at ≈640k tokens (64% of the window)')
  })
  test('below the threshold it stays quiet', async ($, on) => {
    const { logs, suggestions } = engine(on, undefined, true, 590_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    expect(suggestions).toEqual([])
    expect(logs).toEqual([])
  })
  test('a compaction re-arms it', async ($, on) => {
    const { suggestions } = engine(on, undefined, true, 700_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
    await $.turn.complete(turnEnd('answer'))
    expect(suggestions).toEqual(['/smart-compact:save', '/smart-compact:save'])
  })
})

describe('long-horizon compactions', () => {
  const PROFILE = '/Users/x/.claude/smart-compact/profile.md'
  test('an automatic compaction carries the default contract', async ($, on) => {
    const { compactions } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
    expect(compactions[0]?.instructions?.startsWith('Long-horizon summary contract')).toBe(true)
    expect(compactions[0]?.instructions).toContain('"go with recs"')
  })
  test("the profile's own contract replaces the default", async ($, on) => {
    const { compactions } = engine(on, undefined, true, 1_000, { ...FILES, [PROFILE]: '# Profile\n## Summary contract\n- Keep the HANDOFF number.\n## Save\n- x\n' })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
    expect(compactions[0]?.instructions).toContain('- Keep the HANDOFF number.')
    expect(compactions[0]?.instructions).not.toContain('"go with recs"')
  })
  test("after a save, the plugin's compaction and every later one keep the checkpoint", async ($, on) => {
    const { compactions, clock, runQueued } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    await runQueued($ as never)
    // The plugin's own /compact: its SAVE line first, the contract after, no second pointer.
    expect(compactions[0]?.instructions?.startsWith(INSTRUCTIONS)).toBe(true)
    expect(compactions[0]?.instructions).toContain('Long-horizon summary contract')
    expect(compactions[0]?.instructions?.split('CHECKPOINT:').length).toBe(2)
    // A later automatic compaction re-states the pointer, so the opt-in rehydrate survives it.
    await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
    expect(compactions[1]?.instructions).toContain(`CHECKPOINT: ${CKPT} (saved 2026-11-03T12:00:00Z`)
  })
  test('a save that drops a standing rule is refused until it carries or retires it', async ($, on) => {
    const PREV = '/Users/x/.claude/checkpoints/-Users-x-proj/prev.ckpt.md'
    const front = (extra: string) => `---\ncreated: 2026-11-04T12:00:00Z\nproject_root: /Users/x/proj\nprevious: ${PREV}\nrebuild_budget: 150k\n---\n${extra}`
    const files = {
      ...FILES,
      [PREV]: '## 1. Standing rules\n- Push means production: ask before any push (2026-10-20, always)\n- Claude tests its own work\n',
      [CKPT]: front('## 1. Standing rules\n- Claude tests its own work\n'),
    }
    const { compactions, clock } = engine(on, undefined, true, 1_000, files)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    const refused = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(String(refused.deny ?? refused.text)).toContain('"Push means production: ask before any push (2026-10-20, always)"')
    files[CKPT] = front('## 1. Standing rules\n- Claude tests its own work\n- Push means production; ask Ryan before any push\n')
    const queued = await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    expect(queued.deny).toBe(undefined)
    await $.turn.complete(turnEnd('aborted'))
    await clock.advance(200)
    expect(compactions.length).toBe(0)
  })
  test("the save suggestion fires at 60% of the session's own auto-compaction point", async ($, on) => {
    const early = engine(on, undefined, true, 250_000, FILES, 400_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    expect(early.suggestions).toEqual(['/smart-compact:save'])
    expect(early.logs.join('\n')).toContain('context is at ≈250k tokens')
  })
  test('without a known auto-compaction point, 60% of the window: quiet at 250k', async ($, on) => {
    const late = engine(on, undefined, true, 250_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    expect(late.suggestions).toEqual([])
  })
})

describe('adaptive: the pending list and the save suggestion', () => {
  test('every compaction quotes the newest pending list verbatim, with the reply', async ($, on) => {
    const { compactions } = engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    const messages = [
      { role: 'assistant', text: ASKING, toolUses: [] },
      { role: 'user', text: 'go with recs', toolUses: [] },
    ]
    await $.session.compact({ trigger: 'auto', messages } as never)
    expect(compactions[0]?.instructions).toContain('1. **Deploy main now?** Rec: yes.\n2. Use the supplier API or scrape the price pages?\n   Options: API, scrape. Rec: API.')
    expect(compactions[0]?.instructions).toContain('The user\'s reply, verbatim: "go with recs"')
  })
  test('no save suggestion while a compaction waits to run', async ($, on) => {
    const { commands, suggestions, clock } = engine(on, undefined, true, 870_000, FILES, 1_000_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({ tool: TOOL_ID, instructions: INSTRUCTIONS, checkpoint: CKPT } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    // A message typed meanwhile ends its turn before that /compact runs; a save then would only compact again.
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands.map(c => c.command)).toEqual(['compact'])
    expect(suggestions).toEqual([])
  })
  test('it never saves on its own: it suggests', async ($, on) => {
    const { commands, suggestions, clock } = engine(on, undefined, true, 870_000, FILES, 1_000_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands).toEqual([])
    expect(suggestions).toEqual(['/smart-compact:save'])
  })
  test('suggestAt -1: no suggestion', { options: { suggestAt: -1 } }, async ($, on) => {
    const { commands, suggestions, clock } = engine(on, undefined, true, 870_000, FILES, 1_000_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(commands).toEqual([])
    expect(suggestions).toEqual([])
  })
  test('a low /autocompact point counts from the first turn, far below the model window', async ($, on) => {
    // Regression, 2026-11-04: the point was only read past 20% of the window, so 150k of a 1M window never asked.
    const { suggestions, clock } = engine(on, undefined, true, 150_000, FILES, 160_000)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete(turnEnd('answer'))
    await clock.advance(200)
    expect(suggestions).toEqual(['/smart-compact:save']) // 60% of 160k, not of the 1M window
  })
})

