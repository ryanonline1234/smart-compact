---
name: rehydrate
description: Rebuild context after a smart-compact compaction, from the checkpoint /smart-compact:save wrote. Runs only when the user sends /smart-compact:rehydrate.
argument-hint: "[checkpoint path] [budget, e.g. 100k]"
disable-model-invocation: true
---

# smart-compact: rehydrate

Reads the checkpoint `/smart-compact:save` wrote and executes its rehydration manifest, up to the rebuild budget. The user chose to run this; never start it on your own.

## Arguments

- A path to a `.ckpt.md` file → rehydrate from that file.
- A budget like `100k` → overrides the checkpoint's `rebuild_budget`.
- Both may be given, in either order.

## Steps

0. **No-op check.** If a line `REHYDRATED: <filename>` naming the checkpoint you would load is already in context, reply "Already rehydrated from <filename>" and stop.
1. **Locate**, in order:
   1. the explicit path argument;
   2. the path in a `CHECKPOINT:` line in the current compact summary;
   3. the newest checkpoint for this directory, by filename:
      ```bash
      SLUG=$(pwd | sed 's|[^A-Za-z0-9]|-|g'); CKPT_DIR="$HOME/.claude/checkpoints/$SLUG"
      ls "$CKPT_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$' | sort -r | head -1
      ```
   A named path (from 1 or 2) that doesn't exist is a **hard stop**: it was archived or the pointer got mangled. List `$CKPT_DIR` and its `archive/` with dates and ask which to use. Never silently substitute the newest for a named one. If nothing is found anywhere, say so, naming the directory searched, and stop. Offer a plain rebuild instead: the project's state files, `git log --oneline -15 && git diff --stat`, and a search of past transcripts.
   Located via (3): read only the frontmatter and §1 first, then ask *"Rehydrating from <file>: task <goal line>, saved <created> (<age>). Confirm?"* A sibling session in the same directory writes look-alike checkpoints.
2. **Guards**, before spending the budget:
   - The context is not freshly compacted (long history visible) → warn and confirm.
   - The frontmatter `cwd` differs from the current directory → stop and ask.
   - `git rev-parse --short HEAD` differs from the frontmatter SHA → announce the drift (`git log <sha>..HEAD --oneline | wc -l` commits) and treat every `file:line` target as suspect: re-locate by the manifest's anchor before reading.
   - The checkpoint predates this session or is over 12 hours old → report its age and §1 goal, require explicit confirmation, and skip step 6.
3. **Read the checkpoint fully, then execute §6** in order, tracking spend with prose ≈ chars/2.7 and code ≈ chars/2.5. Stop at the budget, which the argument overrides. Re-check real headroom every few items: estimates are not the truth. Skip items whose full content is already in context (compaction re-attaches up to five recent small files); count them separately and don't re-read them.
4. **Report**, opening with `Checkpoint: <filename>, saved <timestamp> (<age>)`, then three buckets: items re-read (about how many tokens), items already in context (list them), items skipped for budget or another reason (list them, with reasons). Never claim a full rehydration if anything was skipped. If the checkpoint is not fresh, add that work after the save survives only in the compact summary and in lookback (step 7). End with the exact line:
   `REHYDRATED: <checkpoint filename>`
5. **Staleness rule:** files re-read now are the truth. Where the checkpoint's claims conflict with the disk, trust the disk and flag the drift.
6. **Continue** from the checkpoint's next action if the user's message also asked for work. Skip this if any step-2 guard fired.
7. **Lookback** for anything the checkpoint missed: search past transcripts with whatever memory or search tool this session has. Fallback: `grep -l <pattern> ~/.claude/projects/$SLUG/*.jsonl`, then extract only the matching lines. Never read whole transcripts into context.
