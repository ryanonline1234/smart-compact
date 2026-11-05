# Checkpoint template

Copy this structure, substituting every `<angle-bracket>` field. Keep every
section — write "none" rather than omitting. Sections 1 and 2 come first on
purpose: they are what got lost after compactions, and they override the rest.

```markdown
---
created: <ISO8601 UTC>
project_root: <absolute path of the project this session works on: its git top level, not the shell's cwd>
cwd: <absolute pwd at save>
previous: <absolute path of the newest earlier checkpoint for this project, or none>
git: <branch> @ <short SHA>, dirty|clean        # omit if not a repo
iteration: <the project's own counter, e.g. HANDOFF/83 (next free 84), phase 05, v1.7; none if it has none>
transcript_dir: ~/.claude/projects/<slug>/
rebuild_budget: <tokens, default 150k>
next_action: <same imperative line as §3>
---

## 1. Standing rules
Every rule, preference, constraint and permission the user stated that still applies. Newest wins.
`- <the rule, in the user's words where possible> (stated <YYYY-MM-DD>, scope: task | project | always)`
Carry every rule from `previous` forward; drop one only as `- retired: <rule> (why)`.
A rule that outlives this session belongs where Claude Code re-injects it after every
compaction (the project's CLAUDE.md, its rules doc, auto memory): write it there and keep
`- promoted to <file>: <rule>` here.

## 2. Open decisions
Every numbered question put to the user that is not settled: numbering as asked, the options,
and the recommendation, verbatim, so "go with recs" still points at the same list.
`1. <question> Options: <a>, <b>. Rec: <rec>.`
Settled since `previous`: `- answered: <question> ("<the user's words, conditions included>")`. Only the user settles a
question: what you did on your own does not answer it.
Then the user's requests that are not done yet: `- request: <what> (asked <date>)`.

## 3. Task state
Goal (one line). Plan with progress markers (done / doing / todo).
Must agree with §1: where they differ, §1 wins and this section is the one to fix.
**Next action:** one imperative line — the first unfinished item of the plan above, approved work that has not run
included. If it waits on the user's answer, say so and name what can run meanwhile.

## 4. Decisions, with rationale
Append-order: `<decision> — because <why> [file:line if applicable]`
Only decisions too session-specific for the project's own decision log. Nearly empty when
the save flushed to DECISIONS.md first.

## 5. What worked, what didn't
`- worked: <goal> → <exact command or steps> → <evidence>`
`- dead end: <attempt> → <failure mode> → <lesson>`
Methods that worked are lost as easily as dead ends: record both.

## 6. Verbatim vault
Only content that must survive byte-exact AND is not on disk: error traces,
API responses, URLs, IDs, magic numbers, draft prose. On disk = pointer, not copy.
Redaction outranks byte-exactness: credential material (API keys, bearer/session
tokens, cookies, signed query strings like X-Amz-Signature) → `<REDACTED:kind>`
plus a transcript grep pattern to recover it if truly needed.

## 7. Rehydration manifest
Ordered; execute top-down, stop at rebuild_budget.
Targets: `path` (whole file), `path:80-240` (lines), `path#Next action` (the section under the
first heading starting with that text), `path#last 3` (the last three `##` entries of an
append-only log). Prefer sections to whole files: state files are rewritten every round and
grow large. Never list CLAUDE.md, rules files or memory: Claude Code re-injects them.
Relative paths resolve against `project_root`.
Estimate: prose ≈ chars/2.7, code ≈ chars/2.5 (measured 2026-11-03 on Claude 5 models: the Read tool's output, line numbers included, within 12% per file), CJK ≈ chars/1.0 (unmeasured).
`anchor` = a distinctive string inside the target, so it can be re-located if the file drifted.

| # | action | target | anchor | ~tokens | why |
|---|--------|--------|--------|---------|-----|
| 1 | Read | STATE.md#Next action | — | 1k | the next step, as the project records it |
| 2 | Read | DECISIONS.md#last 3 | — | 3k | the newest decisions |
| 3 | Read | src/foo.ts:80-240 | `applyBeatGrid(` | 2k | active edit site |
| 4 | Run | git log --oneline -15 && git diff --stat | — | 1k | recent motion |
```
