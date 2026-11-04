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

/** A compaction's instructions with the contract (and a checkpoint pointer) added. */
export function withContract(instructions: string | undefined, contract: string, pointer?: string): string {
  const head = instructions !== undefined && instructions.trim() !== '' ? [instructions.trim()] : []
  const keep = pointer !== undefined && !(instructions ?? '').includes('CHECKPOINT:') ? [pointer] : []
  return [...head, `Long-horizon summary contract (smart-compact). Keep, verbatim where it says so:\n${contract}`, ...keep].join('\n\n')
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
  const name = words(bare.split(/(?<=[?.!])\s/)[0] ?? bare)
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
