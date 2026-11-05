---
name: rehydrate
description: Rebuild context after a smart-compact compaction, from the checkpoint /smart-compact:save wrote. Runs only when the user sends /smart-compact:rehydrate.
argument-hint: "[checkpoint path] [budget, e.g. 100k]"
disable-model-invocation: true
---

# smart-compact: rehydrate

Reads the checkpoint `/smart-compact:save` wrote and executes its rehydration manifest, up to the rebuild budget. The user chose to run this; never start it on your own. If `~/.claude/smart-compact/profile.md` exists, read it first: its **Rehydrate** section adds to these steps.

## Arguments

- A path to a `.ckpt.md` file → rehydrate from that file.
- A budget like `100k` → overrides the checkpoint's `rebuild_budget`.
- Both may be given, in either order.

## Steps

0. **No-op check.** If a line `REHYDRATED: <filename>` naming the checkpoint you would load is already in context, reply "Already rehydrated from <filename>" and stop.
1. **Locate**, in order:
   1. the explicit path argument;
   2. the path in a `CHECKPOINT:` line in the current compact summary;
   3. the newest checkpoint for this **project**: `ROOT` is the git top level of the project the session works on (as the save step derives it), and checkpoints live in `~/.claude/checkpoints/<ROOT with every non-alphanumeric character as ->/`. Older checkpoints were filed by the shell's `pwd`; look there second.
      ```bash
      ls "$CKPT_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$' | sort -r | head -1
      ```
   A named path (from 1 or 2) that doesn't exist is a **hard stop**: it was archived or the pointer got mangled. List the directory and its `archive/` with dates and ask which to use. Never silently substitute the newest for a named one. If nothing is found anywhere, say so, naming the directories searched, and stop. Offer a plain rebuild instead: the project's state files, `git log --oneline -15 && git diff --stat`, and a search of past transcripts.
   Located via (3): read only the frontmatter and the standing rules first, then ask *"Rehydrating from <file>: task <goal line>, saved <created> (<age>). Confirm?"* A sibling session on the same project writes look-alike checkpoints.
2. **Guards**, before spending the budget:
   - The context is not freshly compacted (long history visible) → warn and confirm.
   - The frontmatter `project_root` (or, in older checkpoints, `cwd`) is not the project this session works on → stop and ask.
   - `git rev-parse --short HEAD` differs from the frontmatter SHA → announce the drift (`git log <sha>..HEAD --oneline | wc -l` commits) and treat every `file:line` target as suspect: re-locate by the manifest's anchor before reading.
   - The checkpoint predates this session or is over 12 hours old → report its age and goal, require explicit confirmation, and skip step 6.
3. **Read the checkpoint fully.** Sections are found by title, not number: older checkpoints call the standing rules "User directives" and number the manifest §6. **Standing rules and open decisions override everything else**, including the checkpoint's own task state and the compact summary: where they disagree, the rule wins.
   Three cases change that, read from the checkpoint itself. `written_by: plugin (no model: …)`: no model judged §1 and §2, they are carried verbatim, so check each item against the compact summary and treat what the summary shows settled as settled. A `## Since this checkpoint` section: the user's messages after the checkpoint was written, which win where they differ. A checkpoint whose `created` is older than the latest compaction (the summary describes work after it): for anything after `created`, the summary is newer and wins.
4. **Execute the manifest** in order, tracking spend with prose ≈ chars/2.7 and code ≈ chars/2.5. Stop at the budget, which the argument overrides. Skip items whose full content is already in context (compaction re-attaches up to five recent small files); count them separately. Targets:
   - `path` or `path:80-240`: read it, or those lines.
   - `path#Heading`: `grep -n` for the first heading line starting with that text, then read from it with an offset and a limit that stops at the next heading of the same or higher level.
   - `path#last 3`: `grep -n '^## '` and read from the third-last match to the end.
   Relative paths resolve against `project_root`.
5. **Report**, opening with `Checkpoint: <filename>, saved <timestamp> (<age>)`. Then the standing rules in force, and the open decisions as a numbered list with each recommendation, so "go with recs" has a target. Then three buckets: items re-read (about how many tokens), items already in context (list them), items skipped for budget or another reason (list them, with reasons). Never claim a full rehydration if anything was skipped. End with the exact line:
   `REHYDRATED: <checkpoint filename>`
6. **Staleness rule:** files re-read now are the truth. Where the checkpoint's claims conflict with the disk, trust the disk and flag the drift. Then continue from the checkpoint's next action if the user's message also asked for work. Skip this if any step-2 guard fired.
7. **Lookback** for anything the checkpoint missed: search past transcripts with whatever memory or search tool this session has. Fallback: `grep -l <pattern> ~/.claude/projects/*/*.jsonl`, then extract only the matching lines. Never read whole transcripts into context.
