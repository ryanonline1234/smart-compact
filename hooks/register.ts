import type { Register } from 'claude-code'
import { estimateDetails, estimateLine, estimateOf, fmtK, isRead, parseCheckpoint, reattachedFromTranscript, readTarget, sliceLines, tokensOf } from './estimate'
import type { Estimate, Manifest, Measured } from './estimate'

// smart-compact's hooks module. /smart-compact:save writes a checkpoint, then
// calls this module's tool instead of asking the person to paste /compact. The
// tool measures the checkpoint's rehydration manifest and queues: the
// compaction runs when that turn ends, by running /compact as if the person
// typed it. Rehydrating stays the person's choice (/smart-compact:rehydrate).
// Separately, once context passes `suggestAt`, it suggests /smart-compact:save.

export const PLUGIN = 'smart-compact'
export const TOOL = 'compact_after_turn'
export const TOOL_ID = `mcp__${PLUGIN}__${TOOL}`
const MAX_INSTRUCTIONS = 4000
const COMPACT_DELAY_MS = 100

export type Pending = { instructions: string; checkpoint: string }
/** A queued compaction, with the manifest as measured before anything was wiped. */
type Queued = Pending & { estimate?: Estimate; manifest?: Manifest; measured?: Measured[]; checkpointTokens?: number }

/** Pure: the compaction a tool call asks for, or why it is refused. */
export function parseRequest(input: {
  instructions?: unknown
  checkpoint?: unknown
  agentId?: string
}): Pending | { deny: string } {
  if (input.agentId !== undefined) {
    return { deny: 'Only the main conversation can queue a compaction: call this from the main thread, not a subagent or fork.' }
  }
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : ''
  const checkpoint = typeof input.checkpoint === 'string' ? input.checkpoint.trim() : ''
  if (instructions === '') {
    return { deny: '`instructions` is empty: pass the summary instruction line from the SAVE step.' }
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return { deny: `\`instructions\` is ${instructions.length} characters; keep it under ${MAX_INSTRUCTIONS}. It is a pointer, not the checkpoint.` }
  }
  if (!checkpoint.startsWith('/') || !checkpoint.endsWith('.md')) {
    return { deny: '`checkpoint` must be the absolute path of the .md checkpoint this SAVE wrote.' }
  }
  if (!instructions.includes(checkpoint)) {
    return { deny: '`instructions` must contain the checkpoint path, so the summary carries it.' }
  }
  return { instructions, checkpoint }
}

/** The line the person pastes when the automatic compaction did not run. */
export function fallbackLine(p: Pending): string {
  return `/compact ${p.instructions}`
}

/** What /compact is given: the SAVE line, plus the estimate for the summary to carry. */
export function compactArgs(q: Queued): string {
  return q.estimate === undefined ? q.instructions : `${q.instructions} Also state in the summary, verbatim: "${estimateLine(q.estimate)}"`
}

/** Pure: " (412k → 31k tokens)" when both sizes are known, else "". */
export function sizes(r: { tokensBefore?: number; tokensAfter?: number }): string {
  if (r.tokensBefore === undefined || r.tokensAfter === undefined) return ''
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return ` (${k(r.tokensBefore)} → ${k(r.tokensAfter)} tokens)`
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Pure: what the queue tool tells the model, with the estimate measured at save. */
export function queuedReport(estimate: Estimate | undefined): string {
  const lines = ['Queued. Claude Code compacts this conversation as soon as this turn ends, with these instructions.']
  if (estimate !== undefined) {
    lines.push(`Measured: ${estimateLine(estimate)} Quote this in the SAVE report.`)
    if (estimate.missingTargets.length > 0) {
      lines.push(`Not found on disk, so rehydrate cannot read them: ${estimate.missingTargets.join(', ')}. Fix those §6 paths and call this tool again.`)
    }
    if (estimate.overBudgetTargets.length > 0) {
      lines.push(
        `Past rebuild_budget, so rehydrate stops before them: ${estimate.overBudgetTargets.join(', ')}. ` +
          'If they matter, move them up or trim §6, then call this tool again.',
      )
    }
  }
  lines.push('Finish the turn now with the SAVE report; anything done after the save is not in the checkpoint.')
  return lines.join(' ')
}

export const register: Register = (on, options) => {
  // Module state: a reload between the call and the turn's end drops it, and
  // the person then sees no `smart-compact:` line, only the SAVE report.
  let pending: Queued | undefined

  // Suggest /smart-compact:save once context passes `suggestAt` tokens (0: 60% of
  // the window; -1: never), once per stretch between compactions.
  const suggestAt = typeof options.suggestAt === 'number' ? options.suggestAt : 0
  let isNudged = false

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description:
        "Queues a compaction of this conversation that Claude Code runs as soon as the current turn ends, " +
        "with the given instructions (what `/compact <instructions>` would do). For /smart-compact:save only: " +
        'call it after the checkpoint file is written. Its result gives the measured rehydrate estimate and any ' +
        'manifest problems; then finish the turn with the save report and do no other work. Main conversation only.',
      inputSchema: {
        type: 'object',
        properties: {
          instructions: {
            type: 'string',
            description: 'The text that would follow /compact: what the summary must keep verbatim, including the checkpoint path.',
          },
          checkpoint: {
            type: 'string',
            description: 'Absolute path of the .ckpt.md file this SAVE wrote.',
          },
        },
        required: ['instructions', 'checkpoint'],
        additionalProperties: false,
      },
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__smart-compact__compact_after_turn' }, async ($, e) => {
    const request = parseRequest(e as { instructions?: unknown; checkpoint?: unknown; agentId?: string })
    if ('deny' in request) return { deny: request.deny }
    let exists = true
    try {
      exists = await $.fs.exists(request.checkpoint)
    } catch {
      exists = true // no fs beneath (a test host): the path check above stands
    }
    if (!exists) {
      return { deny: `No file at ${request.checkpoint}: write the checkpoint before queuing the compaction.` }
    }
    // Measured now, before anything is wiped: each Read target's size on disk.
    try {
      const saved = await $.fs.read(request.checkpoint)
      const manifest = parseCheckpoint(saved)
      const home = await $.env.get('HOME')
      const measured: Measured[] = []
      for (const item of manifest.items) {
        const target = isRead(item) ? readTarget(item.target, manifest.cwd, home) : undefined
        if (target === undefined) {
          measured.push({ ...item, tokens: item.estTokens ?? 0, isMeasured: false })
          continue
        }
        try {
          const text = await $.fs.read(target.path)
          const { chars, lines } = sliceLines(text, target.start, target.end)
          measured.push({ ...item, path: target.path, tokens: tokensOf(target.path, chars, lines, text), isMeasured: true })
        } catch {
          measured.push({ ...item, path: target.path, tokens: 0, isMeasured: false, isMissing: true })
        }
      }
      const checkpointTokens = tokensOf(request.checkpoint, saved.length, saved.split('\n').length, saved)
      pending = { ...request, estimate: estimateOf(manifest, measured, checkpointTokens), manifest, measured, checkpointTokens }
    } catch {
      pending = { ...request } // unreadable checkpoint or manifest: compact without the estimate
    }
    return { result: queuedReport(pending.estimate) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: its handler failed, so nothing was queued. Fall back to the manual /compact line.` },
  )

  // The compaction this mod queued, and what the engine made of it.
  let expecting: Pending | undefined
  let outcome: { skip?: string; tokensBefore?: number; tokensAfter?: number } | undefined

  // Observe only: records whether the /compact this mod ran stood or was vetoed.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) isNudged = false
    if (expecting !== undefined && e.agentId === undefined && e.trigger !== 'precompute') {
      outcome = result.skip !== undefined ? { skip: result.skip } : { tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter }
    }
    return result
  }).catch(($, e, next) => next(e)) // an observer never stands in a compaction's way

  // Every classic hook event carries the transcript's path; the report reads it.
  let transcriptPath: string | undefined
  const notePath = (path: unknown) => {
    if (typeof path === 'string' && path !== '') transcriptPath = path
  }
  on('classic.SessionStart', ($, e, next) => (notePath(e.transcript_path), next(e))).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', ($, e, next) => (notePath(e.transcript_path), next(e))).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    if (e.agentId !== undefined) return answered
    if (pending === undefined) {
      if (suggestAt < 0 || isNudged || e.reason !== 'answer') return answered
      try {
        const { context } = await $.session.usage()
        const threshold = suggestAt > 0 ? suggestAt : Math.round(context.window * 0.6)
        if (context.tokens !== undefined && context.tokens >= threshold) {
          isNudged = true
          $.ui.log(
            `smart-compact: context is at ≈${fmtK(context.tokens)} tokens (${Math.round((100 * context.tokens) / context.window)}% of the window). ` +
              '/smart-compact:save checkpoints this session and compacts it; rehydrating stays your choice.',
          )
          $.prompt.suggest({ text: '/smart-compact:save' }).catch(() => undefined)
        }
      } catch {
        // no usage reading yet: try again next turn
      }
      return answered
    }
    const request: Queued = pending
    pending = undefined
    if (e.reason !== 'answer') {
      $.ui.log(`smart-compact: not compacted, the turn ended with "${e.reason}". To compact now, paste: ${fallbackLine(request)}`)
      return answered
    }
    // Why /compact and not $.session.compact: an SDK host (the desktop app,
    // -p) refuses $.session.compact, measured 2026-11-03 on 2.1.310. Why a
    // timer: the turn waits on this hook, and a command run from inside it is
    // refused. $.command.run queues /compact until the session is idle.
    $.clock.after(COMPACT_DELAY_MS, () => {
      expecting = request
      outcome = undefined
      $.command.run({ command: 'compact', args: compactArgs(request) }).then(
        async () => {
          const seen = outcome
          expecting = undefined
          outcome = undefined
          if (seen === undefined) {
            $.ui.log(`smart-compact: /compact ran but no compaction was seen. Check the transcript; to compact now, paste: ${fallbackLine(request)}`)
          } else if (seen.skip !== undefined) {
            $.ui.log(`smart-compact: compaction skipped (${seen.skip}). To compact now, paste: ${fallbackLine(request)}`)
          } else {
            // The engine's "after" count leaves out the system prompt and tool
            // definitions (measured 2026-11-03: 28k reported, about 76k in the next
            // request), and /context's local estimate read here is unstable.
            const head = `smart-compact: compacted${sizes(seen)}; the system prompt and tools come on top.`
            // Files compaction already re-attached in full: rehydrate skips them.
            let back: Set<string> | undefined
            try {
              back = transcriptPath === undefined ? undefined : new Set(reattachedFromTranscript(await $.fs.read(transcriptPath)))
            } catch {
              back = undefined
            }
            const after =
              request.manifest === undefined || request.measured === undefined || request.checkpointTokens === undefined
                ? undefined
                : estimateOf(request.manifest, request.measured, request.checkpointTokens, back, request.checkpoint)
            const details = after === undefined ? [] : estimateDetails(after)
            $.ui.log(
              [
                `${head} Checkpoint: ${request.checkpoint}`,
                ...details,
                'Send /smart-compact:rehydrate to rebuild context from it, or keep working from the summary.',
              ].join('\n'),
            )
            // Terminal only: a dim suggestion, Tab to take. Headless and SDK hosts (the desktop app) show none.
            $.prompt.suggest({ text: '/smart-compact:rehydrate' }).catch(() => undefined)
          }
        },
        (err: unknown) => {
          expecting = undefined
          outcome = undefined
          $.ui.log(`smart-compact: compaction failed (${errorText(err)}). To compact now, paste: ${fallbackLine(request)}`)
        },
      )
    })
    return answered
  })
}
