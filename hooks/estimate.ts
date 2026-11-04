// Pure helpers: read a smart-compact checkpoint's rehydration manifest (§6)
// and estimate what `/smart-compact rehydrate` would put back. The mod runs
// them when SAVE queues the compaction, before anything is wiped, measuring
// each Read target on disk; Run and Search items keep the manifest's own guess.

export type ManifestItem = {
  action: string
  target: string
  /** The manifest's own `~tokens` cell, when it parses. */
  estTokens?: number
  why: string
}

export type Manifest = {
  budget?: number
  cwd?: string
  /** The project the checkpoint belongs to; relative targets resolve against it before `cwd`. */
  projectRoot?: string
  /** The checkpoint this one follows, for the carry-forward check. */
  previous?: string
  items: ManifestItem[]
}

export type Measured = ManifestItem & {
  /** A Read target's absolute path, as resolved for measuring. */
  path?: string
  tokens: number
  /** True when the size came from the file on disk, not the manifest's guess. */
  isMeasured: boolean
  isMissing?: boolean
}

export type Estimate = {
  /** Tokens rehydrate would add, the budget applied, the checkpoint included. */
  total: number
  budget?: number
  checkpointTokens: number
  reads: { count: number; tokens: number }
  others: { count: number; tokens: number }
  missing: number
  overBudget: number
  /** The targets behind `missing` and `overBudget`, for the warnings at save. */
  missingTargets: string[]
  overBudgetTargets: string[]
  /** Targets compaction already put back in full, which rehydrate skips; undefined when unknown. */
  back?: string[]
  isCheckpointBack?: boolean
  /** Included items, largest first, for the details line. */
  top: Measured[]
}

/** The Read tool returns at most this many lines when no range is given. */
const READ_DEFAULT_LINES = 2000
// Characters per token of the Read tool's output, measured 2026-11-03 on
// Sonnet 5.5 and Opus 5.5 (identical counts: one tokenizer) over 3 prose and 4
// code files, each within 12%. The skill's older 4 and 3.2 undercounted by
// 1.3-1.5x. CJK is unmeasured: the old 1.5 scaled by the prose drift.
const CHARS_PER_TOKEN = { prose: 2.73, code: 2.49, cjk: 1.0 } as const
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i

/** "2k", "1.5k", "~800", "2,000", "150k tokens" → tokens; anything else undefined. */
export function parseTokens(cell: string): number | undefined {
  const m = cell.replace(/[~≈,\s]|tokens?/gi, '').match(/^(\d+(?:\.\d+)?)(k|m)?$/i)
  if (m === null) return undefined
  const scale = m[2] === undefined ? 1 : m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000
  return Math.round(parseFloat(m[1] ?? '0') * scale)
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

function unquote(s: string): string {
  return s.replace(/^[`'"]+|[`'"]+$/g, '').trim()
}

/** The frontmatter's rebuild_budget, cwd, project_root and previous, and the manifest table's rows. */
export function parseCheckpoint(text: string): Manifest {
  const front = text.match(/^---\n([\s\S]*?)\n---/)
  const field = (name: string) => front?.[1]?.match(new RegExp(`^${name}:\\s*(.+?)\\s*(?:#.*)?$`, 'm'))?.[1]
  const budgetText = field('rebuild_budget')
  const budget = budgetText === undefined ? undefined : parseTokens(budgetText)
  const cwd = field('cwd')
  const projectRoot = field('project_root')
  const previous = field('previous')

  // The manifest is found by its title, so a template that renumbers its sections still parses.
  const section = text.match(/^##\s*(?:\d+\.?\s*)?[^\n]*manifest[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] ?? ''
  const rows = section.split('\n').filter(l => l.trim().startsWith('|'))
  const header = rows.length > 0 ? cells(rows[0] ?? '').map(c => c.toLowerCase()) : []
  const col = (name: string, fallback: number) => {
    const i = header.findIndex(h => h.includes(name))
    return i === -1 ? fallback : i
  }
  const [iAction, iTarget, iTokens, iWhy] = [col('action', 1), col('target', 2), col('token', 4), col('why', 5)]
  const items: ManifestItem[] = []
  for (const row of rows) {
    const c = cells(row)
    if (!/^\d+$/.test(c[0] ?? '')) continue // the header and the |---| rule
    items.push({
      action: unquote(c[iAction] ?? ''),
      target: unquote(c[iTarget] ?? ''),
      estTokens: parseTokens(c[iTokens] ?? ''),
      why: c[iWhy] ?? '',
    })
  }
  const path = (v: string | undefined) => (v === undefined || /^(none|-|n\/a)$/i.test(unquote(v)) ? undefined : unquote(v))
  return { budget, cwd: path(cwd), projectRoot: path(projectRoot), previous: path(previous), items }
}

/** Where a Read target points: a whole file, a line range, a section by heading, or the last N entries. */
export type Target = { path: string; start?: number; end?: number; section?: string; lastN?: number }

/**
 * A Read target as an absolute path plus what part of the file it means, or
 * undefined. `path:80-240` is a line range; `path#Next action` is the section
 * under the first heading starting with that text; `path#last 3` is the last
 * three `##` entries, for append-only logs like DECISIONS.md.
 */
export function readTarget(target: string, root: string | undefined, home: string | undefined): Target | undefined {
  let t = unquote(target)
  let start: number | undefined
  let end: number | undefined
  let section: string | undefined
  let lastN: number | undefined
  const hash = t.indexOf('#')
  if (hash > 0) {
    const frag = t.slice(hash + 1).trim()
    t = t.slice(0, hash)
    const last = frag.match(/^last\s+(\d+)$/i)
    if (last !== null) lastN = Number(last[1])
    else if (frag !== '') section = frag
  }
  const range = section === undefined && lastN === undefined ? t.match(/^(.*?):(\d+)(?:-(\d+))?$/) : null
  if (range !== null) {
    t = range[1] ?? ''
    start = Number(range[2])
    end = range[3] === undefined ? start : Number(range[3])
  }
  if (t === '') return undefined
  if (t.startsWith('~/')) {
    if (home === undefined || home === '') return undefined
    t = `${home}${t.slice(1)}`
  } else if (!t.startsWith('/')) {
    if (root === undefined || !root.startsWith('/')) return undefined
    t = `${root.replace(/\/$/, '')}/${t}`
  }
  return { path: t, start, end, section, lastN }
}

function headingAt(line: string): { level: number; text: string } | undefined {
  const m = line.match(/^(#{1,6})\s+(.*)$/)
  return m === null ? undefined : { level: (m[1] ?? '').length, text: (m[2] ?? '').trim() }
}

/** The lines of the section under the first heading whose text starts with `title` (numbering ignored). */
export function sectionRange(text: string, title: string): { from: number; to: number } | undefined {
  const lines = text.split('\n')
  const want = title.toLowerCase().replace(/^\d+\.?\s*/, '')
  for (let i = 0; i < lines.length; i++) {
    const h = headingAt(lines[i] ?? '')
    if (h === undefined || !h.text.toLowerCase().replace(/^\d+\.?\s*/, '').startsWith(want)) continue
    let j = i + 1
    while (j < lines.length) {
      const next = headingAt(lines[j] ?? '')
      if (next !== undefined && next.level <= h.level) break
      j += 1
    }
    return { from: i, to: j }
  }
  return undefined
}

/** The lines of the last `n` entries of an append-only log: from the n-th last `##` heading (or `###`) to the end. */
export function lastEntriesRange(text: string, n: number): { from: number; to: number } | undefined {
  const lines = text.split('\n')
  for (const level of [2, 3]) {
    const at = lines.flatMap((l, i) => (headingAt(l)?.level === level ? [i] : []))
    if (at.length > 0) return { from: at[Math.max(0, at.length - n)] ?? 0, to: lines.length }
  }
  return undefined
}

/** Characters and lines a target costs, or `found: false` when its section is not in the file. */
export function measureTarget(text: string, target: Target): { chars: number; lines: number; found: boolean } {
  const range = target.section !== undefined ? sectionRange(text, target.section) : target.lastN !== undefined ? lastEntriesRange(text, target.lastN) : undefined
  if ((target.section !== undefined || target.lastN !== undefined) && range === undefined) return { chars: 0, lines: 0, found: false }
  if (range !== undefined) {
    const picked = text.split('\n').slice(range.from, range.to)
    return { chars: picked.reduce((n, l) => n + l.length + 1, 0), lines: picked.length, found: true }
  }
  return { ...sliceLines(text, target.start, target.end), found: true }
}

/** Characters and lines the Read tool would return for the range. */
export function sliceLines(text: string, start?: number, end?: number): { chars: number; lines: number } {
  const all = text.split('\n')
  const from = start === undefined ? 0 : Math.max(0, start - 1)
  const to = start === undefined ? Math.min(all.length, READ_DEFAULT_LINES) : Math.min(all.length, end ?? start)
  const picked = all.slice(from, to)
  return { chars: picked.reduce((n, l) => n + l.length + 1, 0), lines: picked.length }
}

/** Tokens the Read tool's output costs: the text plus its "123\t" line-number prefixes. */
export function tokensOf(path: string, chars: number, lines: number, sample: string): number {
  const probe = sample.slice(0, 4000)
  const cjk = (probe.match(/[　-鿿가-힯＀-￯]/g) ?? []).length
  const kind = probe.length > 0 && cjk / probe.length > 0.2 ? 'cjk' : PROSE.test(path) ? 'prose' : 'code'
  const prefixChars = lines * (String(Math.max(lines, 1)).length + 1)
  return Math.round((chars + prefixChars) / CHARS_PER_TOKEN[kind])
}

export function isRead(item: ManifestItem): boolean {
  return /^read$/i.test(item.action)
}

/**
 * Totals in rehydrate's own order: the checkpoint, then items top-down,
 * stopping at the budget. `back` holds the paths compaction re-attached in
 * full: rehydrate skips what is already in context, so they cost nothing.
 */
export function estimateOf(
  manifest: Manifest,
  measured: readonly Measured[],
  checkpointTokens: number,
  back?: ReadonlySet<string>,
  checkpointPath?: string,
): Estimate {
  const isCheckpointBack = back !== undefined && checkpointPath !== undefined && back.has(checkpointPath)
  let total = isCheckpointBack ? 0 : checkpointTokens
  const included: Measured[] = []
  const already: string[] = []
  const overBudgetTargets: string[] = []
  let overBudget = 0
  let isStopped = false
  for (const m of measured) {
    if (m.isMissing === true) continue
    if (back !== undefined && m.path !== undefined && back.has(m.path)) {
      already.push(m.target)
      continue
    }
    // REHYDRATE executes top-down and stops at the budget: everything from the
    // first item that would cross it on is skipped, even a smaller one after.
    if (isStopped || (manifest.budget !== undefined && total + m.tokens > manifest.budget)) {
      isStopped = true
      overBudget += 1
      overBudgetTargets.push(m.target)
      continue
    }
    total += m.tokens
    included.push(m)
  }
  const reads = included.filter(isRead)
  const others = included.filter(m => !isRead(m))
  const sum = (xs: Measured[]) => xs.reduce((n, m) => n + m.tokens, 0)
  return {
    total,
    budget: manifest.budget,
    checkpointTokens,
    reads: { count: reads.length, tokens: sum(reads) },
    others: { count: others.length, tokens: sum(others) },
    missing: measured.filter(m => m.isMissing === true).length,
    overBudget,
    missingTargets: measured.filter(m => m.isMissing === true).map(m => m.target),
    overBudgetTargets,
    top: [...included].sort((a, b) => b.tokens - a.tokens),
    back: back === undefined ? undefined : already,
    isCheckpointBack: back === undefined ? undefined : isCheckpointBack,
  }
}

/**
 * The files compaction re-attached in full: `file` attachment rows after the
 * transcript's last compact boundary. The engine writes these rows without
 * raising session.append (measured 2026-11-03), so the transcript is the record.
 */
export function reattachedFromTranscript(jsonl: string): string[] {
  const at = jsonl.lastIndexOf('"compact_boundary"')
  if (at === -1) return []
  const found: string[] = []
  for (const line of jsonl.slice(jsonl.indexOf('\n', at) + 1).split('\n')) {
    if (!line.includes('"attachment"')) continue
    try {
      const row = JSON.parse(line) as { type?: unknown; attachment?: { type?: unknown; filename?: unknown } }
      if (row.type === 'attachment' && row.attachment?.type === 'file' && typeof row.attachment.filename === 'string') {
        found.push(row.attachment.filename)
      }
    } catch {
      // a partial last line: skip
    }
  }
  return found
}

/** 2140 → "2.1k", 38_400 → "38k", 640 → "0.6k". */
export function fmtK(n: number): string {
  const k = n / 1000
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
}

/** One sentence for the compaction instructions, so the summary carries the numbers. */
export function estimateLine(e: Estimate): string {
  const parts = [`${e.reads.count} file reads ≈${fmtK(e.reads.tokens)} measured`]
  if (e.others.count > 0) parts.push(`${e.others.count} commands/searches ≈${fmtK(e.others.tokens)} estimated`)
  parts.push(`checkpoint ≈${fmtK(e.checkpointTokens)}`)
  return `Rehydrate estimate at save: up to ≈${fmtK(e.total)} tokens (${parts.join('; ')}); less for files compaction puts back.`
}

/** The transcript lines shown after compaction. */
export function estimateDetails(e: Estimate, contextNow?: number): string[] {
  const after = contextNow === undefined ? '' : ` (→ ≈${fmtK(contextNow + e.total)})`
  const budget = e.budget === undefined ? '' : `, budget ${fmtK(e.budget)}`
  const lines = [`Rehydrate would add ≈${fmtK(e.total)} tokens${after}, measured at save${budget}:`]
  const reads = e.top.filter(isRead)
  if (reads.length > 0) {
    const shown = reads.slice(0, 4).map(m => `${m.target} ${fmtK(m.tokens)}${m.why === '' ? '' : ` (${m.why})`}`)
    const more = reads.length > 4 ? `; +${reads.length - 4} more` : ''
    lines.push(`  files: ${e.reads.count} ≈${fmtK(e.reads.tokens)} measured — ${shown.join('; ')}${more}`)
  }
  if (e.others.count > 0) {
    const shown = e.top.filter(m => !isRead(m)).slice(0, 3).map(m => `${m.action} ${m.target.slice(0, 40)}`)
    lines.push(`  commands/searches: ${e.others.count} ≈${fmtK(e.others.tokens)} (the manifest's estimates) — ${shown.join('; ')}`)
  }
  lines.push(e.isCheckpointBack === true ? '  checkpoint itself: already back' : `  checkpoint itself ≈${fmtK(e.checkpointTokens)}`)
  const notes: string[] = []
  if (e.back !== undefined && e.back.length > 0) notes.push(`already back after compaction, so skipped: ${e.back.join(', ')}`)
  if (e.overBudget > 0) notes.push(`${e.overBudget} item${e.overBudget === 1 ? '' : 's'} past the budget would be skipped`)
  if (e.missing > 0) notes.push(`${e.missing} file${e.missing === 1 ? '' : 's'} missing at save`)
  if (e.back === undefined) notes.push('less if compaction already re-attached some of these files')
  if (notes.length > 0) lines.push(`  ${notes.join('; ')}`)
  return lines
}
