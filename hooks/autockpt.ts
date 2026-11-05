// Checkpoints at compactions the plugin did not start: Claude Code's own (at its
// threshold, or precomputed in the background) and a bare /compact the user
// types. A fork of the main thread writes them: the same model over the same
// transcript with tools denied, given the save skill's rules, the template, the
// profile, the previous checkpoint and the disk facts a save would look up with
// its tools. The plugin then checks them like a manual save. Pure functions
// only; register.ts runs them.
import { askInstruction, blocks, isCarried, isSettled, listItems, sectionText } from './ledger'
import type { PendingAsk, Row } from './ledger'

/** Checkpoint file names this plugin and the save skill write. */
export const CHECKPOINT_NAME = /^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$/
export const DEFAULT_BUDGET = '150k'
const MAX_FACT = 1500
const MAX_USER_MESSAGE = 700

/** What a manual save looks up with its tools, gathered by the plugin before the fork. */
export type DiskFacts = {
  projectRoot: string
  cwd: string
  git?: { branch: string; head: string; isDirty: boolean; status: string; log: string }
  checkpointDir: string
  /** Checkpoint file names in `checkpointDir`, newest first. */
  listing: readonly string[]
  state?: { path: string; next?: string; open?: string }
  decisions?: { path: string; headings: readonly string[] }
  /** The newest numbered handoff, relative to the project root. */
  handoff?: string
  /** Files the main loop read or edited, newest first. */
  recentFiles: readonly string[]
}

export type AutoInput = {
  path: string
  createdAt: string
  trigger: string
  facts: DiskFacts
  previous?: { path: string; text: string }
  ask?: PendingAsk
  template: string
  /** The save skill's own "Write the checkpoint" step. */
  writeSteps?: string
  /** The profile's Save section. */
  profileSave?: string
  transcriptDir?: string
}

/** YYYYMMDDTHHMMSSZ, as the save skill names checkpoints. */
export function stampOf(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

export function slugOf(root: string): string {
  return root.replace(/[^A-Za-z0-9]/g, '-')
}

export function autoName(createdAt: string): string {
  return `${stampOf(createdAt)}-auto.ckpt.md`
}

const FILE_TOOLS = /^(?:Read|Edit|MultiEdit|Write|NotebookEdit)$/

/** Absolute files the main loop read or edited, newest first, each once. */
export function recentFilesOf(rows: readonly Row[], max = 12): string[] {
  const seen: string[] = []
  for (let i = rows.length - 1; i >= 0 && seen.length < max; i--) {
    const uses = rows[i]?.toolUses ?? []
    for (let j = uses.length - 1; j >= 0 && seen.length < max; j--) {
      const u = uses[j]
      if (u === undefined || !FILE_TOOLS.test(u.tool)) continue
      const path = u.input?.file_path ?? u.input?.notebook_path
      if (typeof path === 'string' && path.startsWith('/') && !seen.includes(path)) seen.push(path)
    }
  }
  return seen
}

const EDIT_TOOLS = /^(?:Edit|MultiEdit|Write|NotebookEdit)$/

/** Absolute files the main loop edited or wrote, newest first, each once. */
export function editedFilesOf(rows: readonly Row[]): string[] {
  const seen: string[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const uses = rows[i]?.toolUses ?? []
    for (let j = uses.length - 1; j >= 0; j--) {
      const u = uses[j]
      if (u === undefined || !EDIT_TOOLS.test(u.tool)) continue
      const path = u.input?.file_path ?? u.input?.notebook_path
      if (typeof path === 'string' && path.startsWith('/') && !seen.includes(path)) seen.push(path)
    }
  }
  return seen
}

/** The directory most of those files sit in: where to look for the project's git root. */
export function projectDirGuess(files: readonly string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const f of files) {
    const dir = f.slice(0, f.lastIndexOf('/')) || '/'
    if (dir.includes('/.claude/')) continue // checkpoints, memory, settings: not the project
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  let best: string | undefined
  let n = 0
  for (const [dir, c] of counts) if (c > n) [best, n] = [dir, c]
  return best
}

/** The previous checkpoint: the newest by name. */
export function newestCheckpoint(names: readonly string[]): string | undefined {
  return [...names].filter(n => CHECKPOINT_NAME.test(n)).sort().reverse()[0]
}

export function gitLine(git: DiskFacts['git']): string | undefined {
  return git === undefined ? undefined : `${git.branch} @ ${git.head}, ${git.isDirty ? 'dirty' : 'clean'}`
}

/** The save skill's "Write the checkpoint" step, cut from its SKILL.md. */
export function writeStepsFrom(skill: string): string | undefined {
  const start = skill.indexOf('3. **Write the checkpoint**')
  const end = skill.indexOf('\n4. **', start)
  return start === -1 || end === -1 ? undefined : skill.slice(start, end).trim()
}

function clip(text: string, max: number): string {
  const t = text.replace(/^\n+/, '').trimEnd() // leading spaces carry meaning in `git status --short`
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** The frontmatter the plugin knows for certain; the writer fills in `iteration` and `next_action`. */
export function frontmatter(input: AutoInput, fill: { iteration?: string; nextAction?: string }, writtenBy: string): string {
  const { facts } = input
  const lines = [
    '---',
    `created: ${input.createdAt}`,
    `project_root: ${facts.projectRoot}`,
    `cwd: ${facts.cwd}`,
    `previous: ${input.previous?.path ?? 'none'}`,
    ...(facts.git === undefined ? [] : [`git: ${gitLine(facts.git)}`]),
    `iteration: ${fill.iteration ?? 'none'}`,
    `transcript_dir: ${input.transcriptDir ?? 'unknown'}`,
    `rebuild_budget: ${DEFAULT_BUDGET}`,
    `next_action: ${fill.nextAction ?? 'see §3'}`,
    `written_by: ${writtenBy}`,
    `compaction: ${input.trigger}`,
    '---',
  ]
  return lines.join('\n')
}

function factLines(facts: DiskFacts): string[] {
  const out: string[] = []
  if (facts.git !== undefined) {
    out.push(`- git: ${gitLine(facts.git)}`)
    out.push(`- git status --short:\n${clip(facts.git.status || '(clean)', MAX_FACT)}`)
    out.push(`- git log --oneline -5:\n${clip(facts.git.log, MAX_FACT)}`)
  } else {
    out.push('- not a git repository (or git was unavailable)')
  }
  if (facts.state !== undefined) {
    out.push(`- ${facts.state.path} "Next action":\n${clip(facts.state.next ?? '(no such section)', MAX_FACT)}`)
    out.push(`- ${facts.state.path} "Open questions":\n${clip(facts.state.open ?? '(no such section)', MAX_FACT)}`)
  }
  if (facts.decisions !== undefined) out.push(`- ${facts.decisions.path}, newest headings: ${facts.decisions.headings.join(' | ') || '(none)'}`)
  if (facts.handoff !== undefined) out.push(`- newest handoff: ${facts.handoff}`)
  if (facts.recentFiles.length > 0) out.push(`- files this session read or edited, newest first:\n${facts.recentFiles.map(f => `  ${f}`).join('\n')}`)
  out.push(`- checkpoints for this project (${facts.checkpointDir}), newest first: ${facts.listing.slice(0, 10).join(', ') || '(none)'}`)
  return out
}

/** What the fork is asked: the checkpoint /smart-compact:save would write, from the conversation above. */
export function forkPrompt(input: AutoInput): string {
  const parts = [
    '[smart-compact plugin, not the user] Claude Code is compacting this conversation now. Write the checkpoint that /smart-compact:save would write at this moment, from everything above. ' +
      'This request has no tools: write from the conversation and the disk facts below, and never present as checked something you did not see. ' +
      'Do not address the user and do not continue the task.',
    'Output only the checkpoint file: start with its `---` frontmatter line and end with the manifest table, nothing before or after. ' +
      `Use this frontmatter, filling in only iteration and next_action:\n${frontmatter(input, { iteration: '<fill in>', nextAction: '<fill in: the same line as §3\'s Next action>' }, 'fork')}`,
  ]
  if (input.writeSteps !== undefined) parts.push(`How to write it (the save skill's rules):\n${input.writeSteps}`)
  parts.push(`The template:\n${input.template}`)
  if (input.profileSave !== undefined && input.profileSave !== '') parts.push(`The user's profile adds (its Save section):\n${input.profileSave}`)
  parts.push(
    input.previous === undefined
      ? 'There is no previous checkpoint for this project: §1 and §2 come from this conversation alone.'
      : `The previous checkpoint (${input.previous.path}). Every standing rule and open decision in it must appear in yours, or be settled by name as \`retired: …\`, \`answered: …\` or \`promoted to <file>: …\`:\n${input.previous.text}`,
  )
  if (input.ask !== undefined) parts.push(`The newest pending decision, as the plugin captured it from the conversation:\n${askInstruction(input.ask)}`)
  parts.push(`Disk facts the plugin gathered just now, in place of the tools a save would use:\n${factLines(input.facts).join('\n')}`)
  parts.push(
    `For §7, list only targets that exist: the paths above and files you saw read or written in this conversation, relative to ${input.facts.projectRoot} where they sit inside it. ` +
      'Prefer section targets (`path#Heading`, `path#last N`) to whole files. Never list CLAUDE.md, rules files or memory.',
  )
  return parts.join('\n\n')
}

/** The writer's reply as a checkpoint: fences stripped, and its frontmatter replaced by the plugin's facts. */
export function composeCheckpoint(reply: string, input: AutoInput, writtenBy: string): string | undefined {
  let text = reply.trim()
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```\s*$/)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  const start = text.indexOf('---')
  if (start > 0 && !text.slice(0, start).includes('## ')) text = text.slice(start)
  let body = text
  const fill: { iteration?: string; nextAction?: string } = {}
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end === -1) return undefined
    const head = text.slice(3, end)
    fill.iteration = head.match(/^iteration:\s*(.+)$/m)?.[1]?.trim()
    fill.nextAction = head.match(/^next_action:\s*(.+)$/m)?.[1]?.trim()
    body = text.slice(end + 4).trim()
  }
  if (!/^##\s*1\.?\s/m.test(body) || !/rehydration manifest/i.test(body)) return undefined
  if (fill.iteration?.startsWith('<')) fill.iteration = undefined
  if (fill.nextAction?.startsWith('<')) fill.nextAction = undefined
  return `${frontmatter(input, fill, writtenBy)}\n\n${body}\n`
}

const RULE_TITLES = ['standing rules', 'user directives']
const DECISION_TITLES = ['open decisions']

/** The previous checkpoint's rules and open decisions the new one drops, whole (carryForwardGaps clips them). */
export function droppedItems(previous: string, next: string): { rules: string[]; decisions: string[] } {
  const later = blocks(next)
  const from = (titles: string[]) => titles.flatMap(t => listItems(previous, t)).filter(x => !isSettled(x) && !isCarried(x, later))
  return { rules: from(RULE_TITLES), decisions: from(DECISION_TITLES) }
}

/** Inserts lines at the end of the section whose heading includes `title`. */
function appendToSection(md: string, title: string, lines: readonly string[]): string {
  if (lines.length === 0) return md
  const rows = md.split('\n')
  const want = title.toLowerCase()
  let start = -1
  let level = 0
  let end = rows.length
  for (let i = 0; i < rows.length; i++) {
    const m = (rows[i] ?? '').match(/^(#{1,6})\s+(.*)$/)
    if (m === null) continue
    if (start === -1) {
      if ((m[2] ?? '').toLowerCase().includes(want)) [start, level] = [i, (m[1] ?? '').length]
    } else if ((m[1] ?? '').length <= level) {
      end = i
      break
    }
  }
  if (start === -1) return md
  let at = end
  while (at > start + 1 && (rows[at - 1] ?? '').trim() === '') at--
  rows.splice(at, 0, ...lines)
  return rows.join('\n')
}

/** Last resort after the retries: the dropped items, carried verbatim and marked. */
export function carryDropped(md: string, dropped: { rules: readonly string[]; decisions: readonly string[] }): string {
  const mark = (x: string) => `- carried by the plugin (the writer dropped it): ${x}`
  return appendToSection(appendToSection(md, 'standing rules', dropped.rules.map(mark)), 'open decisions', dropped.decisions.map(mark))
}

/** Removes manifest rows whose target is not on disk, and says so under the table. */
export function dropMissingTargets(md: string, missing: readonly string[]): string {
  if (missing.length === 0) return md
  const kept = md
    .split('\n')
    .filter(line => {
      const cells = line.split('|').map(c => c.trim())
      return !(cells.length > 4 && /^\d+$/.test(cells[1] ?? '') && missing.some(m => (cells[3] ?? '').includes(m)))
    })
    .join('\n')
  return `${kept.trimEnd()}\n\nDropped by the plugin, not on disk: ${missing.join(', ')}.\n`
}

/** The ask for a corrected checkpoint, when the checks refused the fork's: no transcript needed. */
export function retryPrompt(draft: string, refusal: string, previous: string | undefined, files?: string): string {
  return [
    "You wrote this checkpoint for a Claude Code session, and the smart-compact plugin's check refused it.",
    `The refusal:\n${refusal}`,
    ...(files === undefined ? [] : [`Files in the project (git ls-files), to correct the manifest's paths:\n${files}`]),
    ...(previous === undefined ? [] : [`The previous checkpoint:\n${previous}`]),
    `Your checkpoint:\n${draft}`,
    'Output the whole corrected checkpoint, changing only what the refusal names, and nothing before or after it.',
  ].join('\n\n')
}

/** The user's newest messages, verbatim: what a plugin-written checkpoint keeps when no model writes one. */
export function userMessages(rows: readonly Row[], n: number): string[] {
  const out: string[] = []
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    const r = rows[i]
    if (r === undefined || r.role !== 'user') continue
    const t = r.text.trim()
    if (t === '' || t.startsWith('<') || t.startsWith('[smart-compact')) continue
    out.unshift(clip(t, MAX_USER_MESSAGE))
  }
  return out
}

/** The checkpoint the plugin writes itself: before the fork lands, and when it cannot. */
export function fallbackCheckpoint(input: AutoInput, rows: readonly Row[], reason: string): string {
  const prevRules = input.previous === undefined ? undefined : sectionText(input.previous.text, 'standing rules') ?? sectionText(input.previous.text, 'user directives')
  const prevOpen = input.previous === undefined ? undefined : sectionText(input.previous.text, 'open decisions')
  const quote = (t: string) => t.split('\n').map(l => `> ${l}`).join('\n')
  const { facts } = input
  const rel = (p: string) => (p.startsWith(`${facts.projectRoot}/`) ? p.slice(facts.projectRoot.length + 1) : p)
  const manifest: string[] = []
  const row = (target: string, why: string) => manifest.push(`| ${manifest.length + 1} | Read | ${target} | — | — | ${why} |`)
  if (facts.state?.next !== undefined) row(`${rel(facts.state.path)}#Next action`, 'the next step, as the project records it')
  if (facts.state?.open !== undefined) row(`${rel(facts.state.path)}#Open questions`, 'open questions, as the project records them')
  if (facts.decisions !== undefined) row(`${rel(facts.decisions.path)}#last 3`, 'the newest decisions')
  if (facts.handoff !== undefined) row(facts.handoff, 'the newest handoff')
  for (const f of facts.recentFiles.filter(f => !f.includes('/.claude/')).slice(0, 5)) row(rel(f), 'read or edited most recently')
  const body = [
    `Written by the plugin without a model (${reason}). Sections 1 and 2 carry the previous checkpoint verbatim and the pending decision as captured; check them against the compaction summary, which is newer.`,
    '',
    '## 1. Standing rules',
    prevRules !== undefined && prevRules !== '' ? prevRules : 'none recorded in the previous checkpoint; see the compaction summary',
    '',
    '## 2. Open decisions',
    ...(input.ask === undefined ? [] : ['The newest pending decision, captured verbatim:', askInstruction(input.ask), '']),
    prevOpen !== undefined && prevOpen !== '' ? `From the previous checkpoint:\n${prevOpen}` : 'none recorded in the previous checkpoint',
    '',
    '## 3. Task state',
    'In the compaction summary.',
    '**Next action:** see the compaction summary.',
    '',
    '## 4. Decisions, with rationale',
    'none',
    '',
    "## 5. What worked, what didn't",
    'none',
    '',
    '## 6. Verbatim vault',
    "The user's newest messages, verbatim:",
    ...userMessages(rows, 6).map(quote),
    '',
    '## 7. Rehydration manifest',
    '',
    '| # | action | target | anchor | ~tokens | why |',
    '|---|--------|--------|--------|---------|-----|',
    ...manifest,
  ]
  return `${frontmatter(input, {}, `plugin (no model: ${reason})`)}\n\n${body.join('\n')}\n`
}

/** What a precomputed checkpoint misses: the user's messages after the precompute ran, verbatim. */
export function gapAppendix(rows: readonly Row[], since: number): string | undefined {
  const later = userMessages(rows.slice(since), 10)
  if (later.length === 0) return undefined
  return [
    '',
    '## Since this checkpoint',
    'Written in the background before the compaction installed. The user wrote these after it, verbatim; they win where they differ:',
    ...later.map(t => t.split('\n').map(l => `> ${l}`).join('\n')),
    '',
  ].join('\n')
}
