import type { Hook, Register } from 'claude-code'
import { autoName, carryDropped, CHECKPOINT_NAME, composeCheckpoint, droppedItems, dropMissingTargets, editedFilesOf, fallbackCheckpoint, forkPrompt, gapAppendix, newestCheckpoint, projectDirGuess, recentFilesOf, retryPrompt, slugOf, writeStepsFrom } from './autockpt'
import type { AutoInput, DiskFacts } from './autockpt'
import { estimateDetails, estimateLine, estimateOf, fmtK, isRead, measureTarget, parseCheckpoint, reattachedFromTranscript, readTarget, tokensOf } from './estimate'
import type { Estimate, Manifest, Measured } from './estimate'
import { askInstruction, boundarySince, carryForwardGaps, contractFrom, nudgeThreshold, pendingAsk, pointerLine, PROFILE_PATH, sectionText, suggestBand, suggestionNote, suggestReason, unquotedAnswers, withContract } from './ledger'
import type { Row } from './ledger'

// smart-compact's hooks module. /smart-compact:save writes a checkpoint, then
// calls this module's tool instead of asking the person to paste /compact. The
// tool measures the checkpoint's rehydration manifest and queues: the
// compaction runs when that turn ends, by running /compact as if the person
// typed it. Rehydrating stays the person's choice (/smart-compact:rehydrate).
// Separately, it suggests /smart-compact:save: once past `suggestAt`, or inside the
// `suggestFrom`–`suggestTo` band at the first turn end after a round closed (else at
// the band's top). The model offers it in its next reply. With `autoRehydrate`, the
// plugin runs /smart-compact:rehydrate itself after a compaction.
// Long-horizon additions (0.2): every compaction, automatic ones included,
// carries a summary contract (standing rules, open decisions, counters) and the
// latest checkpoint's pointer; a save that drops a rule or an open decision the
// previous checkpoint held is refused until it carries or retires it.
// Adaptive additions: every compaction quotes the newest pending decision list
// verbatim. (0.3's automatic save at the turn boundary was retired in 0.3.2: a
// model turn racing the engine's own compaction left two compactors in one session.)
// 0.4: every compaction the plugin did not start (Claude Code's own, precomputed
// ones, a bare /compact) gets a checkpoint, written by a fork of the main thread
// (the same model over the same transcript, tools denied) and checked like a
// manual save. An engine compaction also cancels a save's own /compact.

export const PLUGIN = 'smart-compact'
export const TOOL = 'compact_after_turn'
export const TOOL_ID = `mcp__${PLUGIN}__${TOOL}`
const MAX_INSTRUCTIONS = 4000
const COMPACT_DELAY_MS = 100
/** Main turns a handed-over /compact may wait before it counts as dropped and stops blocking saves. */
const MAX_TURNS_WAITING = 3
/** The fork's first answer plus this many corrections, when the checks refuse it. */
const MAX_ATTEMPTS = 3
/** The skip reason when a save's /compact arrives after Claude Code has already compacted. */
const ALREADY_COMPACTED = 'Claude Code already compacted after the save, so its checkpoint stands and one compaction is enough'
/** Where git lives on a Mac whose Xcode license is not accepted. */
const CLT = '/Library/Developer/CommandLineTools'

/** What a hook is handed as `$`. */
type Dollar = Parameters<Hook<'session.compact'>>[0]
/** A checkpoint being written for a compaction the plugin did not start. */
type AutoRun = { input: AutoInput; rows: readonly Row[]; done: Promise<AutoOutcome> }
type AutoOutcome = { text: string; isFork: boolean; attempts: number; reason?: string }

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
  uncovered: readonly string[] = [],
): string {
  const lines = [lead]
  if (estimate !== undefined) {
    lines.push(`Measured: ${estimateLine(estimate)} Quote this in the SAVE report.`)
    if (estimate.missingTargets.length > 0) {
      lines.push(`Not found on disk, so rehydrate cannot read them: ${estimate.missingTargets.join(', ')}. Fix those §7 paths and call this tool again.`)
    }
    if (estimate.overBudgetTargets.length > 0) {
      lines.push(
        `Past rebuild_budget, so rehydrate stops before them: ${estimate.overBudgetTargets.join(', ')}. ` +
          'If they matter, move them up or trim §7, then call this tool again.',
      )
    }
  }
  if (uncovered.length > 0) {
    lines.push(
      `Edited this session but not in §7: ${uncovered.join(', ')}. Add the ones rehydration needs (a section or line range is enough) and call this tool again; leave out the ones it doesn't.`,
    )
  }
  lines.push('Finish the turn now with the SAVE report; anything done after the save is not in the checkpoint.')
  return lines.join(' ')
}

/** Pure: the refusal when `answered:` lines don't quote the user. */
export function quoteDeny(unquoted: readonly string[]): string {
  return (
    `Not queued: ${unquoted.length} answered line(s) settle a question without the user's words: ${unquoted.map(x => `"${x}"`).join('; ')}. ` +
    'Only the user settles a question: quote what they said, as in `answered: <question> ("<the user\'s words>")`, or carry the question as open if they have not answered it. Then call this tool again.'
  )
}

/** macOS reports /private/var/... from git where a path elsewhere says /var/...: compare them as one. */
const samePath = (p: string) => p.replace(/^\/private(?=\/(?:var|tmp)\/)/, '')

/** Pure: files the session edited that the manifest leaves out, relative to the project (judged 2026-11-04: a save left out the rules doc it had just written). */
export function uncoveredEdits(edited: readonly string[], manifest: Manifest, home: string | undefined, checkpoint: string): string[] {
  const root = manifest.projectRoot ?? manifest.cwd
  const base = root === undefined ? undefined : samePath(root)
  const listed = new Set(
    manifest.items
      .filter(isRead)
      .map(i => readTarget(i.target, root, home)?.path)
      .filter((p): p is string => p !== undefined)
      .map(samePath),
  )
  return edited
    .map(samePath)
    .filter(f => f !== samePath(checkpoint) && (home === undefined || !f.startsWith(`${home}/.claude/`)) && (base === undefined || f.startsWith(`${base}/`)) && !listed.has(f))
    .map(f => (base !== undefined && f.startsWith(`${base}/`) ? f.slice(base.length + 1) : f))
}

/** Pure: the lead when a compaction queued in an earlier turn has not run yet; a second one would compact its summary again. */
export function alreadyQueuedLead(waiting: string, checkpoint: string): string {
  return waiting === checkpoint
    ? 'Already queued: a compaction with this checkpoint, queued in an earlier turn, has not run yet; it runs when this turn ends. ' +
        'Nothing more was queued and no second call is needed. Say so in the SAVE report.'
    : `Already queued: a compaction queued in an earlier turn (checkpoint ${waiting}) has not run yet; it runs when this turn ends ` +
        'and now carries this checkpoint instead. Nothing more was queued. Say so in the SAVE report.'
}

/** What the auto-checkpoint helpers read of the module's state. */
type Env = { home?: string; cwd?: string; profilePath?: string; transcriptPath?: string }

/** Each Read target in a checkpoint's manifest, measured on disk now, before anything is wiped. */
async function measureItems($: Dollar, manifest: Manifest, home: string | undefined): Promise<Measured[]> {
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
  return measured
}

/** Runs git in `dir`; again with the Command Line Tools when plain git fails (an unaccepted Xcode license). */
async function git($: Dollar, dir: string, args: readonly string[]): Promise<string | undefined> {
  const run = async (env?: Record<string, string>) => {
    const r = await $.process.run(['git', '-C', dir, ...args], env === undefined ? { timeoutMs: 10_000 } : { env, timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout.trimEnd() : undefined // leading spaces carry meaning in `status --short`
  }
  try {
    return (await run()) ?? (await run({ DEVELOPER_DIR: CLT }))
  } catch {
    return undefined
  }
}

async function readOr($: Dollar, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

/** What a manual save looks up with its tools: the project, its git state and state files, earlier checkpoints. */
async function gatherFacts($: Dollar, rows: readonly Row[], env: Env): Promise<DiskFacts | undefined> {
  const { home, cwd } = env
  if (home === undefined) return undefined
  const recentFiles = recentFilesOf(rows)
  const start = projectDirGuess(recentFiles) ?? cwd ?? '/'
  const top = await git($, start, ['rev-parse', '--show-toplevel'])
  const projectRoot = top ?? start
  let gitFacts: DiskFacts['git']
  if (top !== undefined) {
    const [branch, head, status, log] = await Promise.all([
      git($, top, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git($, top, ['rev-parse', '--short', 'HEAD']),
      git($, top, ['status', '--short']),
      git($, top, ['log', '--oneline', '-5']),
    ])
    gitFacts = { branch: branch ?? '?', head: head ?? '?', isDirty: (status ?? '') !== '', status: (status ?? '').split('\n').slice(0, 30).join('\n'), log: log ?? '' }
  }
  const checkpointDir = `${home}/.claude/checkpoints/${slugOf(projectRoot)}`
  let listing: string[] = []
  try {
    listing = (await $.fs.list(checkpointDir)).map(f => f.name).filter(n => CHECKPOINT_NAME.test(n)).sort().reverse()
  } catch {
    listing = [] // no folder yet: the first checkpoint for this project
  }
  let state: DiskFacts['state']
  for (const path of [`${projectRoot}/STATE.md`, `${projectRoot}/docs/STATE.md`]) {
    const text = await readOr($, path)
    if (text === undefined) continue
    state = { path, next: sectionText(text, 'next action'), open: sectionText(text, 'open questions') }
    break
  }
  let decisions: DiskFacts['decisions']
  for (const path of [`${projectRoot}/DECISIONS.md`, `${projectRoot}/docs/DECISIONS.md`]) {
    const text = await readOr($, path)
    if (text === undefined) continue
    decisions = { path, headings: text.split('\n').filter(l => l.startsWith('## ')).slice(-3).map(l => l.slice(3)) }
    break
  }
  let handoff: string | undefined
  try {
    const names = (await $.fs.list(`${projectRoot}/HANDOFF`)).map(f => f.name).filter(n => /^\d+.*\.md$/.test(n))
    const newest = names.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).pop()
    handoff = newest === undefined ? undefined : `HANDOFF/${newest}`
  } catch {
    handoff = undefined
  }
  return { projectRoot, cwd: cwd ?? '/', git: gitFacts, checkpointDir, listing, state, decisions, handoff, recentFiles }
}

/**
 * Starts a checkpoint for a compaction the plugin did not start: the plugin's
 * own version is written first, so the summary's pointer always leads to a
 * file, then a fork of the main thread writes the real one alongside the summary.
 */
async function startAuto($: Dollar, rows: readonly Row[], trigger: string, env: Env): Promise<AutoRun | undefined> {
  const { home, profilePath, transcriptPath } = env
  const facts = await gatherFacts($, rows, env)
  if (facts === undefined) return undefined
  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const path = `${facts.checkpointDir}/${autoName(createdAt)}`
  const prevName = newestCheckpoint(facts.listing)
  const prevPath = prevName === undefined ? undefined : `${facts.checkpointDir}/${prevName}`
  const prevText = prevPath === undefined ? undefined : await readOr($, prevPath)
  const root = $.plugin.root
  const template = (await readOr($, `${root}/skills/save/TEMPLATE.md`)) ?? ''
  const skill = await readOr($, `${root}/skills/save/SKILL.md`)
  const profile = profilePath === undefined ? undefined : await readOr($, profilePath)
  const transcriptDir = transcriptPath === undefined ? undefined : transcriptPath.slice(0, transcriptPath.lastIndexOf('/') + 1).replace(home ?? '\u0000', '~')
  const input: AutoInput = {
    path,
    createdAt,
    trigger,
    facts,
    previous: prevPath === undefined || prevText === undefined ? undefined : { path: prevPath, text: prevText },
    ask: pendingAsk(rows),
    template,
    writeSteps: skill === undefined ? undefined : writeStepsFrom(skill),
    profileSave: profile === undefined ? undefined : sectionText(profile, 'save'),
    transcriptDir,
  }
  await $.fs.write(path, fallbackCheckpoint(input, rows, 'the fork has not finished'))
  return { input, rows, done: writeAuto($, input, rows, home) }
}

/** The fork's checkpoint, checked like a manual save's: corrected up to MAX_ATTEMPTS, then repaired by the plugin. */
async function writeAuto($: Dollar, input: AutoInput, rows: readonly Row[], home: string | undefined): Promise<AutoOutcome> {
  const fallback = async (reason: string): Promise<AutoOutcome> => {
    const text = fallbackCheckpoint(input, rows, reason)
    await $.fs.write(input.path, text)
    return { text, isFork: false, attempts: 0, reason }
  }
  let reply: Awaited<ReturnType<Dollar['model']['fork']>>
  try {
    reply = await $.model.fork({ prompt: forkPrompt(input) })
  } catch (err) {
    return fallback(`the fork failed: ${errorText(err)}`)
  }
  if (!reply.isAnswered) return fallback(`the fork did not answer: ${reply.reason}`)
  let text = composeCheckpoint(reply.text, input, 'fork')
  if (text === undefined) return fallback('the fork answered without a checkpoint')
  let attempts = 1
  const missingIn = async (md: string) => (await measureItems($, parseCheckpoint(md), home)).filter(m => m.isMissing === true).map(m => m.target)
  let model: string | undefined
  try {
    model = await $.session.model()
  } catch {
    model = undefined
  }
  while (attempts < MAX_ATTEMPTS && model !== undefined) {
    const carry = input.previous === undefined ? undefined : carryForwardDeny(input.previous.path, carryForwardGaps(input.previous.text, text))
    const unquoted = unquotedAnswers(input.previous?.text, text)
    const refusal = [carry, unquoted.length === 0 ? undefined : quoteDeny(unquoted)].filter(x => x !== undefined).join('\n') || undefined
    const missing = await missingIn(text)
    if (refusal === undefined && missing.length === 0) break
    const why = [refusal, missing.length === 0 ? undefined : `These §7 targets are not on disk: ${missing.join(', ')}. Correct their paths or drop those rows.`].filter(x => x !== undefined).join('\n')
    const files = missing.length === 0 ? undefined : (await git($, input.facts.projectRoot, ['ls-files']))?.split('\n').slice(0, 300).join('\n')
    const r = await $.model.complete({ model, prompt: retryPrompt(text, why, input.previous?.text, files), maxTokens: 16_000, timeoutMs: 180_000 })
    attempts += 1
    if (!r.isAnswered) break
    const fixed = composeCheckpoint(r.text, input, 'fork')
    if (fixed === undefined) break
    text = fixed
  }
  // What still fails after the corrections: the plugin carries dropped items verbatim and drops missing targets, and says so.
  if (input.previous !== undefined) {
    const dropped = droppedItems(input.previous.text, text)
    if (dropped.rules.length + dropped.decisions.length > 0) text = carryDropped(text, dropped)
  }
  text = dropMissingTargets(text, await missingIn(text))
  text = text.replace(/^written_by: .*$/m, `written_by: fork (${attempts} attempt${attempts === 1 ? '' : 's'})`)
  await $.fs.write(input.path, text)
  return { text, isFork: true, attempts }
}

/** The notice once the checkpoint for a compaction the plugin did not start is on disk. */
async function announceAuto($: Dollar, run: AutoRun, o: AutoOutcome, sized: string, env: Env, isAutoRehydrate = false): Promise<void> {
  const { home, transcriptPath } = env
  const manifest = parseCheckpoint(o.text)
  const measured = await measureItems($, manifest, home)
  const checkpointTokens = tokensOf(run.input.path, o.text.length, o.text.split('\n').length, o.text)
  let back: Set<string> | undefined
  try {
    back = transcriptPath === undefined ? undefined : new Set(reattachedFromTranscript(await $.fs.read(transcriptPath)))
  } catch {
    back = undefined
  }
  const after = estimateOf(manifest, measured, checkpointTokens, back, run.input.path)
  const who = o.isFork
    ? `written by a fork of this session (${o.attempts} attempt${o.attempts === 1 ? '' : 's'})`
    : `written by the plugin without a model (${o.reason ?? 'no reason given'})`
  $.ui.log(
    [
      `smart-compact: Claude Code compacted this conversation${sized}; a checkpoint for it was ${who}: ${run.input.path}`,
      ...estimateDetails(after),
      isAutoRehydrate ? 'Rehydrating from it now (autoRehydrate).' : 'Send /smart-compact:rehydrate to rebuild context from it, or keep working from the summary.',
    ].join('\n'),
  )
  if (!isAutoRehydrate) $.prompt.suggest({ text: '/smart-compact:rehydrate' }).catch(() => undefined)
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
  // A band replaces the single point when both ends are set: the point then varies with each session's work.
  const suggestFrom = typeof options.suggestFrom === 'number' ? options.suggestFrom : 0
  const suggestTo = typeof options.suggestTo === 'number' ? options.suggestTo : 0
  const isBand = suggestFrom > 0 && suggestTo >= suggestFrom
  let isNudged = false
  /** The suggestion the model reads with the user's next message, once. */
  let note: string | undefined
  // autoRehydrate: "off" (default), "after-save" (after the plugin's own compaction), "always" (after Claude Code's too).
  const autoRehydrate = options.autoRehydrate === 'after-save' || options.autoRehydrate === 'always' ? options.autoRehydrate : 'off'
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
  // A checkpoint at every compaction the plugin did not start, unless turned off.
  const isAutoCheckpointOn = options.checkpointOnCompact !== false
  /** Where the session started; desktop sessions often start at `/`. */
  let cwd: string | undefined
  /** Main-conversation compactions that stood (precomputes not counted). */
  let compactions = 0
  /** `compactions` when `expecting` was handed over: a later one means Claude Code compacted first. */
  let expectingEpoch = 0
  /** A checkpoint written at a precompute, waiting for the compaction that installs its summary. */
  let precomputed: { run: AutoRun; seen: number } | undefined
  /** The session transcript's path, from any classic hook event. */
  let transcriptPath: string | undefined

  on('session.start', async ($, e, next) => {
    cwd = typeof e.cwd === 'string' ? e.cwd : undefined
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
    let uncovered: string[] = []
    // Measured now, before anything is wiped: each Read target's size on disk.
    try {
      const saved = await $.fs.read(request.checkpoint)
      const manifest = parseCheckpoint(saved)
      // Carry-forward: a save may not silently drop what the previous checkpoint still needed.
      let prior: string | undefined
      if (manifest.previous !== undefined) {
        try {
          prior = await $.fs.read(manifest.previous)
        } catch {
          prior = undefined // previous file gone: nothing to compare against
        }
        const refusal = prior === undefined ? undefined : carryForwardDeny(manifest.previous, carryForwardGaps(prior, saved))
        if (refusal !== undefined) return { deny: refusal }
      }
      // Only the user settles a question: an answered line quotes them.
      const unquoted = unquotedAnswers(prior, saved)
      if (unquoted.length > 0) return { deny: quoteDeny(unquoted) }
      const measured = await measureItems($, manifest, home)
      try {
        uncovered = uncoveredEdits(editedFilesOf((await $.session.messages()) as unknown as readonly Row[]), manifest, home, request.checkpoint)
      } catch {
        uncovered = [] // no transcript to read: nothing to compare
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
    return { result: queuedReport(queued.estimate, undefined, uncovered) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: its handler failed, so nothing was queued. Fall back to the manual /compact line.` },
  )

  // Every compaction of the main conversation, automatic and precomputed ones
  // included, carries the summary contract and the latest checkpoint's pointer.
  // Then it records whether the /compact this mod ran stood or was vetoed.
  on('session.compact', async ($, e, next) => {
    let event = e
    const isMain = e.agentId === undefined
    // The /compact a save queued, as the engine raises it.
    const isOurs = isMain && expecting !== undefined && e.trigger === 'manual' && (e.instructions ?? '').includes(expecting.checkpoint)
    if (isOurs && compactions > expectingEpoch) {
      // Claude Code compacted after the save handed this over: a second compaction would summarize the summary.
      outcome = { skip: ALREADY_COMPACTED }
      return { skip: ALREADY_COMPACTED }
    }
    if (isOurs && superseding !== undefined && expecting !== undefined) {
      expecting = superseding
      superseding = undefined
      event = { ...e, instructions: compactArgs(expecting) }
    }
    // A compaction the plugin did not start gets a checkpoint of its own. A pasted save line already names one.
    const isPastedSave = e.trigger === 'manual' && /CHECKPOINT: \S+\.ckpt\.md/.test(e.instructions ?? '')
    const rows = e.messages as unknown as readonly Row[]
    let auto: AutoRun | undefined
    if (isMain && !isOurs && !isPastedSave && isAutoCheckpointOn) {
      if (e.trigger !== 'precompute' && precomputed !== undefined) {
        auto = precomputed.run // its summary, computed in the background, is what installs now
      } else {
        try {
          auto = await startAuto($, rows, e.trigger, { home, cwd, profilePath, transcriptPath })
          if (auto !== undefined) lastCheckpoint = { path: auto.input.path, savedAt: auto.input.createdAt }
        } catch (err) {
          $.ui.log(`smart-compact: no checkpoint for this compaction (${errorText(err)}).`)
          auto = undefined
        }
        if (auto !== undefined && e.trigger === 'precompute') precomputed = { run: auto, seen: rows.length }
      }
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
    } else if (auto !== undefined) {
      const pointer = pointerLine(auto.input.path, auto.input.createdAt) // contract off: the pointer alone
      event = { ...event, instructions: [event.instructions, pointer].filter(x => x !== undefined && x.trim() !== '').join('\n\n') }
    }
    const result = await next(event)
    if (isMain && e.trigger !== 'precompute' && result.skip === undefined) {
      isNudged = false
      note = undefined
      compactions += 1
      if (!isOurs && pending !== undefined) {
        // Claude Code compacted while a save's turn ran: the save's checkpoint stands, and its /compact must not follow.
        pending = undefined
        $.ui.log("smart-compact: Claude Code compacted during the save, so the save's own compaction is cancelled; its checkpoint stands.")
      }
      if (auto !== undefined) {
        const run = auto
        const since = precomputed !== undefined && precomputed.run === run ? precomputed.seen : undefined
        const sized = sizes(result)
        precomputed = undefined
        // Not awaited: the compaction installs now, and the notice follows once the checkpoint is final.
        void run.done
          .then(async o => {
            const extra = since === undefined ? undefined : gapAppendix(rows, since)
            const final = extra === undefined ? o : { ...o, text: `${o.text.trimEnd()}\n${extra}` }
            if (extra !== undefined) await $.fs.write(run.input.path, final.text)
            await announceAuto($, run, final, sized, { home, transcriptPath }, autoRehydrate === 'always')
            if (autoRehydrate === 'always') {
              $.clock.after(COMPACT_DELAY_MS, () => {
                $.command.run({ command: 'smart-compact:rehydrate', args: 'auto' }).catch((err: unknown) => $.ui.log(`smart-compact: the automatic rehydrate did not start (${errorText(err)}). /smart-compact:rehydrate does it by hand.`))
              })
            }
          })
          .catch((err: unknown) => $.ui.log(`smart-compact: the checkpoint for this compaction failed (${errorText(err)}); the plugin's own version is at ${run.input.path}.`))
      }
    }
    if (expecting !== undefined && e.agentId === undefined && e.trigger !== 'precompute') {
      outcome = result.skip !== undefined ? { skip: result.skip } : { tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter }
    }
    return result
  }).catch(($, e, next) => next(e)) // an observer never stands in a compaction's way

  // Every classic hook event carries the transcript's path (declared above); the report reads it.
  const notePath = (path: unknown) => {
    if (typeof path === 'string' && path !== '') transcriptPath = path
  }
  on('classic.SessionStart', ($, e, next) => (notePath(e.transcript_path), next(e))).catch(($, e, next) => next(e))
  // The suggestion reaches the model with the user's next message, so its reply offers the save
  // (an SDK host such as the desktop app shows no prompt suggestion). Not with a smart-compact command.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    notePath(e.transcript_path)
    const result = await next(e)
    if (note === undefined) return result
    const extra = note
    note = undefined
    if (/^\s*\/smart-compact:/.test(String((e as { prompt?: unknown }).prompt ?? ''))) return result
    return { ...result, additionalContext: [...(result?.additionalContext ?? []), extra] }
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
      if (e.reason !== 'answer') return answered
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
        if (isNudged || context.tokens === undefined) return answered
        const after = autoRehydrate === 'off' ? 'rehydrating stays your choice' : 'rehydrating runs on its own afterwards'
        if (isBand) {
          const band = suggestBand(suggestFrom, suggestTo, autoCompactAt, context.window)
          if (context.tokens < band.from) return answered
          let isBoundary = false
          try {
            isBoundary = boundarySince((await $.session.messages()) as unknown as readonly Row[])
          } catch {
            isBoundary = false // no transcript to read: wait for the band's top
          }
          const reason = suggestReason(context.tokens, band, isBoundary)
          if (reason === undefined) return answered
          isNudged = true
          note = suggestionNote(context.tokens, reason, band, autoRehydrate !== 'off')
          $.ui.log(
            `smart-compact: context is at ≈${fmtK(context.tokens)} tokens, inside your ${fmtK(band.from)}–${fmtK(band.to)} band` +
              (reason === 'boundary' ? ', right after a round closed' : '') +
              `. /smart-compact:save checkpoints this session and compacts it; ${after}. Claude will offer it in its next reply.`,
          )
          $.prompt.suggest({ text: '/smart-compact:save' }).catch(() => undefined)
          return answered
        }
        if (suggestAt < 0) return answered
        const threshold = nudgeThreshold(suggestAt, context.window, autoCompactAt)
        if (context.tokens >= threshold) {
          isNudged = true
          note = suggestionNote(context.tokens, 'point', undefined, autoRehydrate !== 'off')
          $.ui.log(
            `smart-compact: context is at ≈${fmtK(context.tokens)} tokens (${Math.round((100 * context.tokens) / context.window)}% of the window). ` +
              `/smart-compact:save checkpoints this session and compacts it; ${after}.`,
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
      expectingEpoch = compactions
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
          } else if (seen.skip === ALREADY_COMPACTED) {
            $.ui.log(`smart-compact: no second compaction: ${ALREADY_COMPACTED}. Checkpoint: ${used.checkpoint}`)
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
                autoRehydrate === 'off' ? 'Send /smart-compact:rehydrate to rebuild context from it, or keep working from the summary.' : 'Rehydrating from it now (autoRehydrate).',
              ].join('\n'),
            )
            if (autoRehydrate === 'off') {
              // Terminal only: a dim suggestion, Tab to take. Headless and SDK hosts (the desktop app) show none.
              $.prompt.suggest({ text: '/smart-compact:rehydrate' }).catch(() => undefined)
            } else {
              // The user turned rehydrating on for every save: run it as they would, once the session is idle.
              $.clock.after(COMPACT_DELAY_MS, () => {
                $.command.run({ command: 'smart-compact:rehydrate', args: 'auto' }).catch((err: unknown) =>
                  $.ui.log(`smart-compact: the automatic rehydrate did not start (${errorText(err)}). /smart-compact:rehydrate does it by hand.`),
                )
              })
            }
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
