// Pure helpers for long-horizon sessions: the summary contract every compaction
// carries, the user's optional profile, and the carry-forward check between two
// checkpoints of the same project. No engine access; register.ts does the I/O.

/** The user's profile, relative to HOME. Optional; its sections extend the skills and the contract. */
export const PROFILE_PATH = '.claude/smart-compact/profile.md'
const MAX_CONTRACT = 2500

/**
 * What every compaction's summary must keep, automatic ones included. Grounded
 * in measured losses (2026-11-04, 35 compactions): standing rules and pending
 * asks were what went missing, and "go with recs" answers a numbered list 73%
 * of the time, so the list itself has to survive.
 */
export const DEFAULT_CONTRACT = [
  '- Every standing rule or preference the user stated, verbatim, with the date and its scope (this task, this project, always). A later rule replaces an earlier one; say which.',
  '- Every numbered question or decision the assistant put to the user that is still open: the numbering as asked, the options, and each recommendation, verbatim, so an answer like "go with recs" still points at the same list.',
  "- The user's latest approvals, verbatim, with any conditions attached to them.",
  '- Requests the user made that are not done yet.',
  '- Counters and pointers that locate the work: iteration or handoff number, branch, worktree, what is merged, what is deployed.',
  '- Methods that worked (the exact command or steps), not only the dead ends.',
  '- Where the task state disagrees with a standing rule, the rule wins: write the task state to match it.',
].join('\n')

/** A markdown section's body: the first heading containing `title`, up to the next heading of its level or higher. */
export function sectionText(md: string, title: string): string | undefined {
  const lines = md.split('\n')
  const want = title.toLowerCase()
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(/^(#{1,6})\s+(.*)$/)
    if (m === null) continue
    if (start === -1) {
      if ((m[2] ?? '').toLowerCase().includes(want)) {
        start = i
        level = (m[1] ?? '').length
      }
    } else if ((m[1] ?? '').length <= level) {
      return lines.slice(start + 1, i).join('\n').trim()
    }
  }
  return start === -1 ? undefined : lines.slice(start + 1).join('\n').trim()
}

/** The contract: the profile's "Summary contract" section when it has one, else the default. */
export function contractFrom(profile: string | undefined): string {
  const own = profile === undefined ? undefined : sectionText(profile, 'summary contract')
  const text = own !== undefined && own !== '' ? own : DEFAULT_CONTRACT
  return text.length > MAX_CONTRACT ? `${text.slice(0, MAX_CONTRACT)}…` : text
}

/** The line that keeps a checkpoint reachable across later compactions. */
export function pointerLine(checkpoint: string, savedAt: string): string {
  return (
    `The summary must keep this line verbatim: "CHECKPOINT: ${checkpoint} (saved ${savedAt}; work after that is only in this summary). ` +
    'Rehydrate from it only when the user sends /smart-compact:rehydrate."'
  )
}

/** A compaction's instructions with the contract, the pending ask and a checkpoint pointer added. */
export function withContract(instructions: string | undefined, contract: string, pointer?: string, ask?: string): string {
  const head = instructions !== undefined && instructions.trim() !== '' ? [instructions.trim()] : []
  const keep = pointer !== undefined && !(instructions ?? '').includes('CHECKPOINT:') ? [pointer] : []
  const asked = ask !== undefined ? [ask] : []
  return [...head, `Long-horizon summary contract (smart-compact). Keep, verbatim where it says so:\n${contract}`, ...asked, ...keep].join('\n\n')
}

/** Top-level list items of a section ("- x", "* x", "1. x"), each with its continuation lines. */
export function listItems(md: string, title: string): string[] {
  const body = sectionText(md, title)
  if (body === undefined) return []
  const items: string[] = []
  for (const line of body.split('\n')) {
    const top = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/)
    if (top !== null) items.push(top[1] ?? '')
    else if (items.length > 0 && /^\s+\S/.test(line)) items[items.length - 1] += ` ${line.trim()}`
  }
  return items.map(s => s.trim()).filter(s => s !== '' && !/^none\.?$/i.test(s))
}

/** Retired, answered, superseded or promoted items need not be carried forward again. */
export function isSettled(item: string): boolean {
  return /^(~~|\*\*)?\s*(retired|answered|done|superseded|promoted)\b/i.test(item) || /\((retired|answered|superseded)\b/i.test(item) || /^~~/.test(item)
}

// Function words, plus the ledger's own structural words, which say nothing about which item it is.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'but', 'you', 'all', 'any', 'its', 'has', 'have', 'into', 'than', 'then', 'when', 'what', 'will', 'can', 'only', 'options', 'option', 'rec', 'recs', 'recommendation', 'stated', 'scope'])
function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[`*_~>"'“”‘’()[\]{}:;,.!?|]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w)),
  )
}

const share = (want: Set<string>, have: Set<string>) => {
  let n = 0
  for (const w of want) if (have.has(w)) n += 1
  return want.size === 0 ? 1 : n / want.size
}

/**
 * True when `later` still accounts for `item`: a block covering most of its
 * words (carried or reworded; parenthetical metadata ignored), or a settled
 * block ("retired:", "answered:", "promoted …") naming its first sentence.
 */
export function isCarried(item: string, later: readonly string[]): boolean {
  const bare = item.replace(/\([^)]*\)/g, ' ')
  const want = words(bare).size > 0 ? words(bare) : words(item)
  if (want.size === 0) return true
  // Markdown first: in "**Deploy now?** Rec: yes" the question ends at "?**", not "? ".
  const plain = bare.replace(/[*_`~]/g, '')
  const name = words(plain.split(/(?<=[?.!])\s/)[0] ?? plain)
  return later.some(candidate => {
    const have = words(candidate)
    return share(want, have) >= 0.6 || (isSettled(candidate) && share(name, have) >= 0.6)
  })
}

/** A document as comparable blocks: list items with their continuation lines, and every other non-empty line. */
export function blocks(md: string): string[] {
  const out: string[] = []
  let inItem = false
  for (const line of md.split('\n')) {
    const top = line.match(/^\s{0,1}(?:[-*]|\d+[.)])\s+(.*)$/)
    if (top !== null) {
      out.push(top[1] ?? '')
      inItem = true
    } else if (inItem && /^\s{2,}\S/.test(line)) {
      out[out.length - 1] += ` ${line.trim()}`
    } else {
      inItem = false
      if (line.trim() !== '') out.push(line.trim())
    }
  }
  return out
}

const RULE_TITLES = ['standing rules', 'user directives']
const DECISION_TITLES = ['open decisions']

/**
 * What the previous checkpoint still needed that the new one drops: standing
 * rules not retired, and open decisions not answered. A rule may move to any
 * section of the new checkpoint (for example "promoted to CLAUDE.md: …").
 */
export function carryForwardGaps(previous: string, next: string): { rules: string[]; decisions: string[] } {
  const from = (titles: string[], md: string) => titles.flatMap(t => listItems(md, t))
  const laterAll = blocks(next)
  const rules = from(RULE_TITLES, previous).filter(r => !isSettled(r) && !isCarried(r, laterAll))
  const decisions = from(DECISION_TITLES, previous).filter(d => !isSettled(d) && !isCarried(d, laterAll))
  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s)
  return { rules: rules.map(clip), decisions: decisions.map(clip) }
}

/** A quoted span: the user's words, in double or single quotes. */
const QUOTED = /(?:^|[\s(:—-])["“'‘][^"”'’\n]{2,}["”'’]/

/**
 * `answered:` lines without the user's words: those settling a question the
 * previous checkpoint left open, or, with no previous checkpoint, every one in
 * the open-decisions section. Only the user settles a question (judged
 * 2026-11-04: a save retired an offer Ryan never answered, because it had acted
 * on its own), and the template's answered line quotes them.
 */
export function unquotedAnswers(previous: string | undefined, next: string): string[] {
  const answered = DECISION_TITLES.flatMap(t => listItems(next, t)).filter(x => /^(~~|\*\*)?\s*answered\b/i.test(x))
  const open = previous === undefined ? undefined : DECISION_TITLES.flatMap(t => listItems(previous, t)).filter(o => !isSettled(o))
  const settling = open === undefined ? answered : answered.filter(a => open.some(o => isCarried(o, [a])))
  return settling.filter(a => !QUOTED.test(a)).map(a => (a.length > 140 ? `${a.slice(0, 140)}…` : a))
}

/**
 * When to suggest saving: `suggestAt` tokens (0: no cap of its own; -1: never),
 * never later than 60% of the point where Claude Code compacts on its own.
 * Measured 2026-11-04: automatic compactions fired from 204k to 970k depending
 * on the model's window, so a fixed number alone fires too late on small windows.
 */
export function nudgeThreshold(suggestAt: number, window: number, autoCompactAt?: number): number {
  if (suggestAt < 0) return Number.POSITIVE_INFINITY
  const ceiling = Math.round(0.6 * (autoCompactAt ?? window))
  return suggestAt > 0 ? Math.min(suggestAt, ceiling) : ceiling
}

// ---------------------------------------------------------------- pending asks

/** A transcript row as the compaction event hands it (SessionMessage's fields this module reads). */
export type Row = {
  role: 'user' | 'assistant'
  text: string
  /** `text` (or `result`) once the call has returned; both absent while it is in flight. */
  toolUses?: readonly { tool: string; input?: Record<string, unknown>; text?: string; result?: unknown }[]
}
export type PendingAsk = {
  list?: string
  buttons?: string
  /** The user's reply: the first message after the ask, or (with `replies`) the first one that answers it. */
  answer?: string
  /** The user's messages since the ask, oldest first: the first three. */
  replies?: string[]
  /** How many more messages came after those three, and the newest of them. */
  more?: number
  latest?: string
  /** Held from before an earlier compaction: the ask itself is no longer in the conversation. */
  isCarried?: boolean
}

const NUMBERED = /^\s*(?:\*\*)?\d{1,2}[.)]/
const ASKS = /\?|\brec(?:s|ommend\w*)?\b/i
const MAX_LIST = 2000

/**
 * The last numbered list in a message that asks something: items with a "?" or
 * a recommendation. Items run to the next item; a blank line followed by
 * unnumbered text ends the list.
 */
export function extractList(text: string): string | undefined {
  const lines = text.split('\n')
  const blocks: string[][] = []
  let block: string[] | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (NUMBERED.test(line)) {
      if (block === undefined) blocks.push((block = []))
      block.push(line)
    } else if (block !== undefined) {
      const next = lines.slice(i + 1).find(l => l.trim() !== '') ?? ''
      if (line.trim() === '' && !NUMBERED.test(next)) block = undefined
      else if (/^#{1,6}\s/.test(line)) block = undefined
      else block.push(line)
    }
  }
  const asking = blocks.filter(b => {
    const items = b.filter(l => NUMBERED.test(l)).length
    const body = b.join('\n')
    return ASKS.test(body) && (items >= 2 || (/\?/.test(body) && /\brec/i.test(body)))
  })
  const last = asking[asking.length - 1]
  if (last === undefined) return undefined
  const out = last.join('\n').trim()
  return out.length > MAX_LIST ? `${out.slice(0, MAX_LIST)}…` : out
}

/** A question put through a tool: the app's next-step box (wrap_up) or AskUserQuestion, with its options. */
function toolAsk(uses: Row['toolUses']): string | undefined {
  for (const u of [...(uses ?? [])].reverse()) {
    const input = u.input ?? {}
    if (/wrap_up$/.test(u.tool) && typeof input.ask === 'string') {
      const labels = Array.isArray(input.actions) ? input.actions.map(a => (a as { label?: unknown }).label).filter(l => typeof l === 'string') : []
      return `${input.ask}${labels.length > 0 ? ` Buttons: ${labels.map(l => `"${l}"`).join(', ')}.` : ''}`
    }
    if (/AskUserQuestion$/.test(u.tool) && Array.isArray(input.questions)) {
      return input.questions
        .map(q => {
          const qq = q as { question?: unknown; options?: { label?: unknown }[] }
          const opts = (qq.options ?? []).map(o => o.label).filter(l => typeof l === 'string')
          return `${String(qq.question ?? '')}${opts.length > 0 ? ` Options: ${opts.map(l => `"${l}"`).join(', ')}.` : ''}`
        })
        .join(' ')
    }
  }
  return undefined
}

/**
 * The newest decision put to the user within the last `maxUserTurns` user
 * messages: a numbered list that asks, and/or a question with buttons, plus the
 * user's reply when there is one. A save-triggered compaction runs a turn after
 * the list, so this looks back, not only at the last message.
 */
export function pendingAsk(rows: readonly Row[], maxUserTurns = 6): PendingAsk | undefined {
  let users = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row === undefined) continue
    if (row.role === 'user') {
      if (row.text.trim() !== '' && (users += 1) > maxUserTurns) return undefined
      continue
    }
    const list = row.text.trim() === '' ? undefined : extractList(row.text)
    const buttons = toolAsk(row.toolUses)
    if (list === undefined && buttons === undefined) continue
    const reply = rows.slice(i + 1).find(r => r.role === 'user' && r.text.trim() !== '' && !r.text.startsWith('<'))
    const answer = reply === undefined ? undefined : reply.text.trim().slice(0, 400)
    return { list, buttons, answer }
  }
  return undefined
}

/** The compaction instruction that keeps a pending ask verbatim. */
export function askInstruction(ask: PendingAsk): string {
  const parts = [
    ask.isCarried === true
      ? 'The latest decision put to the user, captured before an earlier compaction (it is no longer in the conversation above), which a reply like "go with recs" answers. The summary must quote it verbatim, and record the answer if the messages since give one:'
      : 'The latest decision put to the user, which a reply like "go with recs" answers. The summary must quote it verbatim:',
  ]
  if (ask.list !== undefined) parts.push(ask.list)
  if (ask.buttons !== undefined) parts.push(`Asked with buttons: ${ask.buttons}`)
  const replies = ask.replies ?? (ask.answer === undefined ? [] : [ask.answer])
  const more = ask.more ?? 0
  if (replies.length === 0) parts.push('Not answered yet.')
  else if (replies.length === 1 && more === 0) parts.push(`The user's reply, verbatim: "${replies[0]}"`)
  else {
    const tail = more === 0 ? '' : ask.latest === undefined ? ` (and ${more} more)` : ` (and ${more} more, the newest: "${ask.latest}")`
    parts.push(`The user's messages since it was asked, verbatim, oldest first: ${replies.map(r => `"${r}"`).join('; ')}${tail}.`)
  }
  if (ask.replies !== undefined && ask.answer !== undefined && !replies.includes(ask.answer) && ask.answer !== ask.latest) parts.push(`The message that answers it, verbatim: "${ask.answer}"`)
  return parts.join('\n')
}

// ---------------------------------------------------------------- the pending ask, held across compactions (0.6)

/**
 * A pending ask the plugin keeps (in $.store) until the user answers it, so it is
 * supplied at every compaction, not only while it sits within six user messages.
 * Measured 2026-11-05 (docs/04): after the first compaction nothing new was
 * captured, and the list survived only through the summary chain.
 */
export type HeldAsk = {
  list?: string
  buttons?: string
  replies: string[]
  more: number
  latest?: string
  capturedAt: string
  /** The newest user message seen when last held: the messages after it are new. */
  lastSeen?: string
}

const KEEP_REPLIES = 3
const HOLD_DAYS = 7
/** Messages without an answer after which the user has moved on. */
const HOLD_MESSAGES = 20
const REPLY_CHARS = 400

/** A message the user wrote: not a command, a hook's or skill's text, or a compaction summary. */
export function isOwnText(text: string): boolean {
  const t = text.trim()
  return t !== '' && !t.startsWith('<') && !t.startsWith('Base directory for this skill') && !t.startsWith('This session is being continued') && !t.startsWith('[Request interrupted')
}

const APPROVES =
  /^\s*(?:go with (?:the |your |my |all )?(?:recs?|recommendations?)\b|go ahead\b|yes\b|yep\b|yeah\b|sure\b|ok(?:ay)?\b|do it\b|ship it\b|approved?\b|sounds good\b|lgtm\b|proceed\b|no\b|nope\b|not now\b|not yet\b|skip\b|neither\b|both\b|all (?:of them|three|four|five)\b)/i
/** "Build 1 and 2", "Plan option 2", "#1 only", "2 and 3": a reply that picks items by number. */
const PICKS = /^\s*(?:(?:go with|do|build|take|pick|choose|plan|option|ship|merge|yes(?: to)?|no(?: to)?|skip)\s+)*(?:option\s+|#)?\d{1,2}(?:\s*(?:,|and|&|\+)\s*#?\d{1,2})*\b(?![.,]\d)/i

/** Whether a message settles the ask: an approval, a button's label, or a pick by number. Free text does not count. */
export function isAnswer(reply: string, ask: Pick<PendingAsk, 'buttons'>): boolean {
  const t = reply.trim()
  if (APPROVES.test(t) || PICKS.test(t)) return true
  const said = t.toLowerCase().replace(/[.!\s]+$/, '')
  const labels = [...(ask.buttons ?? '').matchAll(/"([^"]+)"/g)].map(m => (m[1] ?? '').toLowerCase().trim()).filter(l => l !== '')
  return labels.some(l => said === l || said.startsWith(`${l} `) || said.startsWith(`${l},`))
}

const clip = (s: string) => s.trim().slice(0, REPLY_CHARS)

/** The newest ask anywhere in the rows, with every message the user wrote after it. */
function newestAsk(rows: readonly Row[]): { list?: string; buttons?: string; replies: string[] } | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row === undefined || row.role !== 'assistant') continue
    const list = row.text.trim() === '' ? undefined : extractList(row.text)
    const buttons = toolAsk(row.toolUses)
    if (list === undefined && buttons === undefined) continue
    const replies = rows.slice(i + 1).filter(r => r.role === 'user' && isOwnText(r.text)).map(r => clip(r.text))
    return { list, buttons, replies }
  }
  return undefined
}

function lastOwn(rows: readonly Row[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r !== undefined && r.role === 'user' && isOwnText(r.text)) return clip(r.text)
  }
  return undefined
}

/** The user's messages in rows that the hold has not seen: after its lastSeen message when that was kept verbatim, else after the summary. */
function newSince(rows: readonly Row[], lastSeen: string | undefined): string[] {
  const own = (from: number) => rows.slice(from).filter(r => r.role === 'user' && isOwnText(r.text)).map(r => clip(r.text))
  let start = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r !== undefined && r.role === 'user' && r.text.trimStart().startsWith('This session is being continued')) {
      start = i + 1
      break
    }
  }
  if (lastSeen !== undefined) {
    const seen = rows.findIndex((r, i) => i >= start && r.role === 'user' && clip(r.text) === lastSeen)
    if (seen !== -1) return own(seen + 1)
  }
  return own(start)
}

/**
 * Which pending ask a compaction supplies, and what is held for the next one.
 * - The newest ask in the conversation wins: supplied while recent (six messages) or unanswered, held while unanswered.
 * - With none in the conversation, the held one is supplied, marked as carried, with the messages since.
 * - An answer is supplied once with its ask; then the hold ends and the summary chain carries the outcome.
 * - A hold also ends after HOLD_DAYS, or HOLD_MESSAGES messages without an answer.
 */
export function nextAsk(rows: readonly Row[], held: HeldAsk | undefined, now: Date): { use?: PendingAsk; hold?: HeldAsk } {
  const fresh = newestAsk(rows)
  if (fresh !== undefined) {
    const answer = fresh.replies.find(r => isAnswer(r, fresh))
    const replies = fresh.replies.slice(0, KEEP_REPLIES)
    const more = fresh.replies.length - replies.length
    const latest = more > 0 ? fresh.replies[fresh.replies.length - 1] : undefined
    const isRecent = fresh.replies.length <= 6
    const use: PendingAsk | undefined = isRecent || answer === undefined ? { list: fresh.list, buttons: fresh.buttons, answer, replies, more, latest } : undefined
    const isSame = held !== undefined && held.list === fresh.list && held.buttons === fresh.buttons
    const hold: HeldAsk | undefined =
      answer !== undefined
        ? undefined
        : { list: fresh.list, buttons: fresh.buttons, replies, more, latest, capturedAt: isSame && held !== undefined ? held.capturedAt : now.toISOString(), lastSeen: lastOwn(rows) }
    return { use, hold }
  }
  if (held === undefined) return { use: undefined, hold: undefined }
  const since = newSince(rows, held.lastSeen)
  const all = [...held.replies, ...since]
  const replies = all.slice(0, KEEP_REPLIES)
  const more = held.more + all.length - replies.length
  const isExpired = now.getTime() - Date.parse(held.capturedAt) > HOLD_DAYS * 86_400_000 || replies.length + more > HOLD_MESSAGES
  if (isExpired) return { use: undefined, hold: undefined }
  const latest = more === 0 ? undefined : (since[since.length - 1] ?? held.latest)
  const answer = since.find(r => isAnswer(r, held))
  const use: PendingAsk = { list: held.list, buttons: held.buttons, answer, replies, more, latest, isCarried: true }
  return { use, hold: answer !== undefined ? undefined : { ...held, replies, more, latest, lastSeen: lastOwn(rows) ?? held.lastSeen } }
}

// ---------------------------------------------------------------- the save suggestion in a band

/** Bash commands that close an iteration: a commit, merge, push or tag, or a production deploy. */
export const BOUNDARY_COMMAND = /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|merge|push|tag)\b|\bvercel\b[^\n]*--prod\b|(?:^|[\s;&|])[\w./~-]*deploy\.sh\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+deploy\b/i
/** Files written at the end of a round: a numbered handoff, the state file, the decision log. */
export const BOUNDARY_FILE = /(?:^|\/)(?:HANDOFF\/\d+[^/]*\.md|STATE\.md|DECISIONS\.md)$/

/** Since the user's last message, did the main loop commit, merge, deploy or write a round-closing file? */
export function boundarySince(rows: readonly Row[]): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r === undefined) continue
    if (r.role === 'user' && r.text.trim() !== '' && !r.text.trimStart().startsWith('<')) return false
    for (const u of r.toolUses ?? []) {
      const command = u.input?.command
      const file = u.input?.file_path
      if (u.tool === 'Bash' && typeof command === 'string' && BOUNDARY_COMMAND.test(command)) return true
      if (/^(?:Edit|MultiEdit|Write)$/.test(u.tool) && typeof file === 'string' && BOUNDARY_FILE.test(file)) return true
    }
  }
  return false
}

/**
 * The band the user picked (`suggestFrom`–`suggestTo`), kept below where Claude
 * Code compacts on its own: at most 90% of that point, so a small window still
 * gets its suggestion in time.
 */
export function suggestBand(from: number, to: number, autoCompactAt: number | undefined, window: number): { from: number; to: number } {
  const top = Math.min(to, Math.round(0.9 * (autoCompactAt ?? 0.85 * window)))
  return { from: Math.min(from, top), to: top }
}

/**
 * When, inside the band, to suggest saving: at the first turn end after a round
 * closed (a commit, merge, deploy or state-file write: the cheapest place to
 * compact, measured 2026-11-04 as 20 of 58 compactions), else at the band's top.
 * So the point varies with each session's work.
 */
export function suggestReason(tokens: number, band: { from: number; to: number }, isBoundary: boolean): 'boundary' | 'top' | undefined {
  if (tokens >= band.to) return 'top'
  if (tokens >= band.from && isBoundary) return 'boundary'
  return undefined
}

/** What the model reads with the user's next message, so its reply offers the save (desktop hosts show no prompt suggestion). */
export function suggestionNote(tokens: number, reason: 'boundary' | 'top' | 'point', band?: { from: number; to: number }, isAutoRehydrate = false): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const where =
    band === undefined
      ? ''
      : `, ${tokens > band.to ? 'past the top of' : 'inside'} the ${k(band.from)}–${k(band.to)} range where the user wants to be offered a save`
  const why = reason === 'boundary' ? ', and a round just closed (a commit, merge, deploy or state-file write), so saving is cheap now' : ''
  const after = isAutoRehydrate ? 'rehydrating runs on its own afterwards' : 'rehydrating stays their choice'
  return (
    `[smart-compact plugin, not the user] This conversation is at ≈${k(tokens)} tokens${where}${why}. ` +
    `After you answer the user's message, add one short line suggesting /smart-compact:save: it checkpoints this session and compacts it, and ${after}. ` +
    'Suggest it once, and do not run it yourself.'
  )
}
