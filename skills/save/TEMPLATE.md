# Checkpoint template

Copy this structure, substituting every `<angle-bracket>` field. Keep every
section — write "none" rather than omitting.

```markdown
---
created: <ISO8601 UTC>
cwd: <absolute path>
git: <branch> @ <short SHA>, dirty|clean        # omit if not a repo
transcript_dir: ~/.claude/projects/<slug>/
rebuild_budget: <tokens, default 150k>
next_action: <same imperative line as §1>
---

## 1. Task state
Goal (one line). Plan with progress markers (done / doing / todo).
**Next action:** one imperative line — the first thing to do after rehydration.

## 2. Decisions, with rationale
Append-order: `<decision> — because <why> [file:line if applicable]`
Only decisions too session-specific for the project's own decision log. This section should be
nearly empty — if it isn't, the SAVE flush step was skipped.

## 3. Dead ends — do not retry
`<attempt> → <failure mode> → <lesson>`
This section is why the rehydrated session doesn't repeat mistakes.

## 4. User directives this session
Exhaustive: every correction, preference, constraint, and scope boundary the
user stated in chat. These survive nowhere else except the raw transcript.

## 5. Verbatim vault
Only content that must survive byte-exact AND is not on disk: error traces,
API responses, URLs, IDs, magic numbers, draft prose. On disk = pointer, not copy.
Redaction outranks byte-exactness: credential material (API keys, bearer/session
tokens, cookies, signed query strings like X-Amz-Signature) → `<REDACTED:kind>`
plus a transcript grep pattern to recover it if truly needed.

## 6. Rehydration manifest
Ordered; execute top-down, stop at rebuild_budget.
Estimate: prose ≈ chars/2.7, code ≈ chars/2.5 (measured 2026-11-03 on Claude 5 models: the Read tool's output, line numbers included, within 12% per file), CJK ≈ chars/1.0 (unmeasured).
`anchor` = a distinctive string inside the target range, so the range can be
re-located by grep if the file drifted since the save.

| # | action | target | anchor | ~tokens | why |
|---|--------|--------|--------|---------|-----|
| 1 | Read | src/foo.ts:80-240 | `applyBeatGrid(` | 2k | active edit site |
| 2 | Run | git log --oneline -15 && git diff --stat | — | 1k | recent motion |
| 3 | Read | docs/STATE.md | — | 1k | project state |
| 4 | Search | transcript search: "<topic>", this session | — | 1k | conversation detail not on disk |
```
