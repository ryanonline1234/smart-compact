import type { Register } from 'claude-code'
import { estimateDetails, estimateLine, estimateOf, fmtK, isRead, measureTarget, parseCheckpoint, reattachedFromTranscript, readTarget, tokensOf } from './estimate'
import type { Estimate, Manifest, Measured } from './estimate'
import { askInstruction, autoSaveReason, BOUNDARY_COMMAND, BOUNDARY_FILE, carryForwardGaps, contractFrom, nudgeThreshold, pendingAsk, pointerLine, PROFILE_PATH, withContract } from './ledger'
import type { AutoSaveMode, Row } from './ledger'

// smart-compact's hooks module. /smart-compact:save writes a checkpoint, then
// calls this module's tool instead of asking the person to paste /compact. The
// tool measures the checkpoint's rehydration manifest and queues: the
// compaction runs when that turn ends, by running /compact as if the person
// typed it. Rehydrating stays the person's choice (/smart-compact:rehydrate).
// Separately, once context passes `suggestAt`, it suggests /smart-compact:save.
// Long-horizon additions (0.2): every compaction, automatic ones included,
// carries a summary contract (standing rules, open decisions, counters) and the
// latest checkpoint's pointer; a save that drops a rule or an open decision the
// previous checkpoint held is refused until it carries or retires it.
// Adaptive additions: every compaction quotes the newest pending decision list
// verbatim; with autoSave "boundary", a turn that ends near the auto-compaction
// point, or right after a commit/merge/deploy, is followed by an automatic save.

export const PLUGIN = 'smart-compact'
export const TOOL = 'compact_after_turn'
export const TOOL_ID = `mcp__${PLUGIN}__${TOOL}`
const MAX_INSTRUCTIONS = 4000
const COMPACT_DELAY_MS = 100
/** Main turns a handed-over /compact may wait before it counts as dropped and stops blocking saves. */
const MAX_TURNS_WAITING = 3

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

/** Pure: the refusal when a save drops what the previous checkpoint still needed. */
export function carryForwardDeny(previous: string, gaps: { rules: string[]; decisions: string[] }): string | undefined {
  if (gaps.rules.length === 0 && gaps.decisions.length === 0) return undefined
  const list = (label: string, xs: string[]) => (xs.length === 0 ? [] : [`${label}: ${xs.map(x => `"${x}"`).join('; ')}.`])
  return [
    `Not queued: the previous checkpoint (${previous}) has items this one drops.`,
    ...list(`${gaps.rules.length} standing rule(s)`, gaps.rules),
    ...list(`${gaps.decisions.length} open decision(s)`, gaps.decisions),
    'Carry each one into this checkpoint, or keep it as "retired: <item> (why)" or "answered: <item> (the answer)", then call this tool again.',
  ].join(' ')
}

/** Pure: what the queue tool tells the model, with the estimate measured at save. */
export function queuedReport(
  estimate: Estimate | undefined,
  lead = 'Queued. Claude Code compacts this conversation as soon as this turn ends, with these instructions.',
): string {
  const lines = [lead]
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

/** Pure: the lead when a compaction queued in an earlier turn has not run yet; a second one would compact its summary again. */
export function alreadyQueuedLead(waiting: string, checkpoint: string): string {
  return waiting === checkpoint
    ? 'Already queued: a compaction with this checkpoint, queued in an earlier turn, has not run yet; it runs when this turn ends. ' +
        'Nothing more was queued and no second call is needed. Say so in the SAVE report.'
    : `Already queued: a compaction queued in an earlier turn (checkpoint ${waiting}) has not run yet; it runs when this turn ends ` +
        'and now carries this checkpoint instead. Nothing more was queued. Say so in the SAVE report.'
}

export const register: Register = (on, options) => {
  // Module state: a reload between the call and the turn's end drops it, and
  // the person then sees no `smart-compact:` line, only the SAVE report.
  let pending: Queued | undefined
  // The /compact this mod handed to the engine and has not seen finish, and what the engine made of it.
  let expecting: Queued | undefined
  let outcome: { skip?: string; tokensBefore?: number; tokensAfter?: number } | undefined
  /** A newer checkpoint saved while `expecting` waited: that compaction carries it, instead of a second one running. */
  let superseding: Queued | undefined
  /** Main turns that ended while `expecting` waited. */
  let turnsWaiting = 0

  // Suggest /smart-compact:save once context passes `suggestAt` tokens (0: 60% of
  // the window; -1: never), once per stretch between compactions.
  const suggestAt = typeof options.suggestAt === 'number' ? options.suggestAt : 0
  let isNudged = false
  let autoCompactAt: number | undefined
  /** Turns since the auto-compaction point was last read; it is read at the first turn's end and every 10th after. */
  let turnsSinceThreshold = -1
  // The summary contract rides on every compaction unless turned off.
  const isContractOn = options.summaryContract !== false
  let home: string | undefined
  /** The profile file: SMART_COMPACT_PROFILE when set (tests, other setups), else ~/.claude/smart-compact/profile.md. */
  let profilePath: string | undefined
  /** The newest checkpoint this session queued; later compactions keep pointing at it. */
  let lastCheckpoint: { path: string; savedAt: string } | undefined
  // autoSave: "suggest" (default) only suggests; "boundary" saves on its own at a turn's end; "off" does neither.
  const autoSave: AutoSaveMode = options.autoSave === 'off' || options.autoSave === 'boundary' ? options.autoSave : 'suggest'
  /** A commit, merge, deploy or round-closing file write since the user last spoke. */
  let sawBoundary = false
  /** An automatic save was queued; no second one until a compaction or the user's next message. */
  let isAutoSaving = false

  on('session.start', async ($, e, next) => {
    try {
      home = await $.env.get('HOME')
      const override = await $.env.get('SMART_COMPACT_PROFILE')
      profilePath = override !== undefined && override !== '' ? override : home === undefined ? undefined : `${home}/${PROFILE_PATH}`
    } catch {
      home = undefined
      profilePath = undefined
    }
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
    let queued: Queued
    // Measured now, before anything is wiped: each Read target's size on disk.
    try {
      const saved = await $.fs.read(request.checkpoint)
      const manifest = parseCheckpoint(saved)
      // Carry-forward: a save may not silently drop what the previous checkpoint still needed.
      if (manifest.previous !== undefined) {
        let prior: string | undefined
        try {
          prior = await $.fs.read(manifest.previous)
        } catch {
          prior = undefined // previous file gone: nothing to compare against
        }
        const refusal = prior === undefined ? undefined : carryForwardDeny(manifest.previous, carryForwardGaps(prior, saved))
        if (refusal !== undefined) return { deny: refusal }
      }
      const root = manifest.projectRoot ?? manifest.cwd
      const measured: Measured[] = []
      for (const item of manifest.items) {
        const target = isRead(item) ? readTarget(item.target, root, home) : undefined
        if (target === undefined) {
          measured.push({ ...item, tokens: item.estTokens ?? 0, isMeasured: false })
          continue
        }
        try {
          const text = await $.fs.read(target.path)
          const m = measureTarget(text, target)
          measured.push(
            m.found
              ? { ...item, path: target.path, tokens: tokensOf(target.path, m.chars, m.lines, text), isMeasured: true }
              : { ...item, path: target.path, tokens: 0, isMeasured: false, isMissing: true },
          )
        } catch {
          measured.push({ ...item, path: target.path, tokens: 0, isMeasured: false, isMissing: true })
        }
      }
      const checkpointTokens = tokensOf(request.checkpoint, saved.length, saved.split('\n').length, saved)
      queued = { ...request, estimate: estimateOf(manifest, measured, checkpointTokens), manifest, measured, checkpointTokens }
      const created = saved.match(/^created:\s*(\S+)/m)?.[1]
      lastCheckpoint = { path: request.checkpoint, savedAt: created ?? new Date().toISOString() }
    } catch {
      queued = { ...request } // unreadable checkpoint or manifest: compact without the estimate
      lastCheckpoint = { path: request.checkpoint, savedAt: new Date().toISOString() }
    }
    // One /compact at a time. A save while an earlier one waits to run would compact the fresh summary again
    // (seen 2026-11-04: a /smart-compact:save typed during an automatic save ran right after it).
    if (expecting !== undefined) {
      if (queued.checkpoint !== expecting.checkpoint) superseding = queued
      return { result: queuedReport(queued.estimate, alreadyQueuedLead(expecting.checkpoint, queued.checkpoint)) }
    }
    pending = queued
    return { result: queuedReport(queued.estimate) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: its handler failed, so nothing was queued. Fall back to the manual /compact line.` },
  )

  // Every compaction of the main conversation, automatic and precomputed ones
  // included, carries the summary contract and the latest checkpoint's pointer.
  // Then it records whether the /compact this mod ran stood or was vetoed.
  on('session.compact', async ($, e, next) => {
    let event = e
    if (
      superseding !== undefined &&
      expecting !== undefined &&
      e.agentId === undefined &&
      e.trigger === 'manual' &&
      (e.instructions ?? '').includes(expecting.checkpoint)
    ) {
      expecting = superseding
      superseding = undefined
      event = { ...e, instructions: compactArgs(expecting) }
    }
    if (isContractOn && e.agentId === undefined) {
      const ask = pendingAsk(e.messages as unknown as readonly Row[])
      let profile: string | undefined
      try {
        profile = profilePath === undefined ? undefined : await $.fs.read(profilePath)
      } catch {
        profile = undefined // no profile: the default contract
      }
      const pointer = lastCheckpoint === undefined ? undefined : pointerLine(lastCheckpoint.path, lastCheckpoint.savedAt)
      event = { ...event, instructions: withContract(event.instructions, contractFrom(profile), pointer, ask === undefined ? undefined : askInstruction(ask)) }
    }
    const result = await next(event)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      isNudged = false
      isAutoSaving = false
      sawBoundary = false
    }
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

  // The user's own message re-arms the automatic save and starts a new stretch for the boundary signal.
  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'sdk' || e.origin.kind === 'bridge') {
      isAutoSaving = false
      sawBoundary = false
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Observe only: the main loop's commits, merges, deploys and round-closing writes mark a boundary.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && BOUNDARY_COMMAND.test(String(e.command ?? ''))) sawBoundary = true
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && BOUNDARY_FILE.test(String(e.file_path ?? ''))) sawBoundary = true
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && BOUNDARY_FILE.test(String(e.file_path ?? ''))) sawBoundary = true
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    if (e.agentId !== undefined) return answered
    if (pending === undefined) {
      if (expecting !== undefined) {
        // A compaction is already on its way: a save or a suggestion now would only lead to a second one.
        // Unless it is lost: a /compact the engine never ran must not block saves for the rest of the session.
        turnsWaiting += 1
        if (turnsWaiting < MAX_TURNS_WAITING) return answered
        $.ui.log(`smart-compact: the queued /compact has not run after ${turnsWaiting} turns, so it counts as dropped. To compact now, paste: ${fallbackLine(expecting)}`)
        expecting = undefined
        superseding = undefined
      }
      if (autoSave === 'off' || e.reason !== 'answer') return answered
      try {
        const { context } = await $.session.usage()
        // Where Claude Code will compact on its own: read at the first turn's end and every 10th turn after,
        // so a lower /autocompact point counts (measured 2026-11-04: a 100k window compacted near 70k).
        turnsSinceThreshold += 1
        if (turnsSinceThreshold === 0 || turnsSinceThreshold >= 10) {
          turnsSinceThreshold = 0
          try {
            autoCompactAt = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.autoCompactThreshold ?? autoCompactAt
          } catch {
            // keep the last reading
          }
        }
        // Automatic save at the turn boundary, before the user's next message overflows the window.
        const reason = context.tokens === undefined ? undefined : autoSaveReason(context.tokens, autoCompactAt ?? context.window, sawBoundary)
        if (autoSave === 'boundary' && !isAutoSaving && reason !== undefined && context.tokens !== undefined) {
          isAutoSaving = true
          const at = autoCompactAt ?? context.window
          const pct = Math.round((100 * context.tokens) / at)
          $.ui.log(
            reason === 'near'
              ? `smart-compact: context is at ≈${fmtK(context.tokens)}, ${pct}% of where Claude Code compacts on its own (≈${fmtK(at)}). Saving now (autoSave), before a turn crosses it. Rehydrating stays your choice.`
              : `smart-compact: a commit, merge, deploy or round-closing write just happened, with context at ≈${fmtK(context.tokens)} (${pct}% of the auto-compaction point). Saving now (autoSave), while it is cheap. Rehydrating stays your choice.`,
          )
          // Not from inside the hook the turn waits on: a command run there is refused.
          $.clock.after(COMPACT_DELAY_MS, () => {
            $.command.run({ command: 'smart-compact:save', args: 'auto' }).catch((err: unknown) => {
              isAutoSaving = false
              $.ui.log(`smart-compact: the automatic save did not start (${errorText(err)}). /smart-compact:save does it by hand.`)
            })
          })
          return answered
        }
        if (suggestAt < 0 || isNudged) return answered
        const threshold = nudgeThreshold(suggestAt, context.window, autoCompactAt)
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
      if (expecting !== undefined) {
        // One /compact at a time: the one already waiting carries this checkpoint instead.
        if (request.checkpoint !== expecting.checkpoint) superseding = request
        return
      }
      expecting = request
      turnsWaiting = 0
      outcome = undefined
      $.command.run({ command: 'compact', args: compactArgs(request) }).then(
        async () => {
          const seen = outcome
          const used = expecting ?? request // a newer save may have taken this compaction over
          expecting = undefined
          outcome = undefined
          superseding = undefined
          if (seen === undefined) {
            $.ui.log(`smart-compact: /compact ran but no compaction was seen. Check the transcript; to compact now, paste: ${fallbackLine(used)}`)
          } else if (seen.skip !== undefined) {
            $.ui.log(`smart-compact: compaction skipped (${seen.skip}). To compact now, paste: ${fallbackLine(used)}`)
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
              used.manifest === undefined || used.measured === undefined || used.checkpointTokens === undefined
                ? undefined
                : estimateOf(used.manifest, used.measured, used.checkpointTokens, back, used.checkpoint)
            const details = after === undefined ? [] : estimateDetails(after)
            $.ui.log(
              [
                `${head} Checkpoint: ${used.checkpoint}`,
                ...details,
                'Send /smart-compact:rehydrate to rebuild context from it, or keep working from the summary.',
              ].join('\n'),
            )
            // Terminal only: a dim suggestion, Tab to take. Headless and SDK hosts (the desktop app) show none.
            $.prompt.suggest({ text: '/smart-compact:rehydrate' }).catch(() => undefined)
          }
        },
        (err: unknown) => {
          const used = expecting ?? request
          expecting = undefined
          outcome = undefined
          superseding = undefined
          $.ui.log(`smart-compact: compaction failed (${errorText(err)}). To compact now, paste: ${fallbackLine(used)}`)
        },
      )
    })
    return answered
  })
}
