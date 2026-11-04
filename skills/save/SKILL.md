---
name: save
description: High-fidelity alternative to a bare /compact. Checkpoints the session to disk, then compacts it automatically when the turn ends; rehydrating stays the user's choice (/smart-compact:rehydrate). Use when the user runs /smart-compact:save, says "smart compact", "save context" or "checkpoint the session", mentions context getting full or nearing the limit, or is about to run /compact on a session worth preserving. Not for handing work to another agent, and not a substitute for a project's own state files — this continues the SAME session past a compaction.
argument-hint: "[rebuild budget, e.g. 100k]"
---

# smart-compact: save

`/compact`'s summary is one generation, and it decides what survives. This plugin wraps it: **save to disk → compact → rehydrate (opt-in)**. Disk has no cap; rehydration rebuilds up to the manifest budget (default 150k tokens, user-overridable) beyond the summary.

```
1. /smart-compact:save        SAVE      — checkpoint to disk; compaction queued for the end of this turn
2. (automatic)                WIPE      — the plugin runs /compact <pointer> when the turn ends
3. /smart-compact:rehydrate   REHYDRATE — the user's choice: read checkpoint + manifest → curated rebuild
```

**Rehydration is opt-in.** After a compaction, never rehydrate on your own, even when the summary carries a `CHECKPOINT:` line. The user decides, by sending `/smart-compact:rehydrate`. If their next message is other work, do it from the summary and mention once, in one line, that `/smart-compact:rehydrate` would rebuild from the checkpoint, quoting the summary's "Rehydrate estimate at save" sentence when it has one.

## Arguments

- None → save with the default 150k rebuild budget.
- A budget like `100k` or `80000` → that rebuild budget.
- Anything else → ask. A save run by mistake right after a compaction becomes the newest checkpoint and shadows the real one.

## Steps

0. **Guard.** If this context looks freshly compacted (short history, a compact summary visible), confirm before saving.
1. **Flush durable state first.** If the project keeps state files (a `STATE.md`, a `DECISIONS.md`, a changelog), update them now. The checkpoint records only what no file on disk can.
2. **Paths.** The directory slug matches `~/.claude/projects/`; the task slug makes the file self-identifying:
   ```bash
   SLUG=$(pwd | sed 's|[^A-Za-z0-9]|-|g')
   CKPT_DIR="$HOME/.claude/checkpoints/$SLUG"; mkdir -p "$CKPT_DIR"
   TASK=<3-6 kebab words naming the task, [a-z0-9-] only>
   CKPT="$CKPT_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$TASK.ckpt.md"
   ```
3. **Write the checkpoint** to `$CKPT` following [TEMPLATE.md](TEMPLATE.md):
   - Dense and factual. No narrative recap of the conversation's journey.
   - `file:line` pointers instead of file contents, except in the verbatim vault.
   - **Never duplicate what's already on disk** (state files, CLAUDE.md, git history, committed code): the manifest re-reads it instead.
   - Section 4 (user directives) must be exhaustive. In-session corrections and preferences survive nowhere else.
   - **Redaction outranks byte-exactness**, inside the vault too: credentials (API keys, bearer or session tokens, cookies, signed query strings) become `<REDACTED:kind>` plus a transcript grep pattern.
   - Keep §6 in the template's table shape, one item per row. `Read` targets are a path (absolute, `~/…`, or relative to `cwd`) with an optional `:start-end`. The plugin parses this table to measure the rehydrate estimate.
   - Manifest budget: default **150k** tokens; the argument overrides; cap at about 50% of the model's context window. Estimate prose ≈ chars/2.7 and code ≈ chars/2.5 (measured on Claude 5 models: the Read tool's output, line numbers included, within 12% per file). CJK is unmeasured; assume chars/1.0.
4. **Prune**, keeping the newest 10 by filename. Only files this skill wrote are moved, into `archive/`, never deleted:
   ```bash
   mkdir -p "$CKPT_DIR/archive"
   ls "$CKPT_DIR" | grep -E '^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$' | sort -r | tail -n +11 \
     | while read -r f; do head -12 "$CKPT_DIR/$f" | grep -q '^rebuild_budget:' \
         && mv "$CKPT_DIR/$f" "$CKPT_DIR/archive/$f"; done
   ```
   Two locks: the name pattern and the `rebuild_budget:` frontmatter marker. The directory can hold look-alike files this skill didn't write; never touch those. List anything archived in the report.
5. **Compact.** The instructions are one line, with `<8-word task summary>` and the `$CKPT` path substituted and every other word verbatim:
   `The summary must contain, verbatim: "Task: <8-word task summary>. CHECKPOINT: <absolute $CKPT path>. Rehydrate from it only when the user sends /smart-compact:rehydrate."`
   - **Auto (default).** Load `mcp__smart-compact__compact_after_turn` with ToolSearch (`select:mcp__smart-compact__compact_after_turn`) and call it with `instructions` = that line and `checkpoint` = the absolute `$CKPT` path. Its result carries a `Measured:` rehydrate estimate and flags §6 targets that are missing or past the budget; fix those and call it again if they matter. Then write step 6's report and end the turn. Start no other work in this turn: the compaction runs as soon as it ends, and anything after the save is not in the checkpoint.
   - **Manual** (the tool does not load or refuses the call). Print `/compact ` + that line in a copyable code block, then the standalone line `CHECKPOINT: <absolute $CKPT path>` outside the block, then: *"Paste that. Afterwards, send `/smart-compact:rehydrate` when you want the rebuild. If the paste mangles, a plain `/compact` is fine: rehydrate finds the checkpoint on disk. Work done after this save is not in the checkpoint."*
6. **Report:** the checkpoint path and size, how the compaction happens (auto: when this turn ends; manual: paste the line), the tool's `Measured:` sentence as the rehydrate estimate (rehydrating is the user's call), anything archived, and the habit line: *"Run /smart-compact:save at 60-70% of the window; /context shows where you are."*

**Late save (≥85% of the window):** delegate the write to a fork (a fork inherits this conversation; a plain subagent does not): "Write the checkpoint for this session to $CKPT per TEMPLATE.md; return only the path and byte count." Call the tool only once the fork's completion arrives, from the main thread; the tool refuses a missing checkpoint file and a subagent caller.

## Notes

- The plugin's hooks module supplies the tool. It runs `/compact` as if the user typed it, because the mod API's direct compact call is refused in SDK hosts such as the desktop app. After compaction it shows a notice with what rehydrating would add, measured on disk before the wipe, minus files compaction already put back.
- A surprise auto-compact is recoverable only if this session saved a checkpoint earlier: everything up to that save comes back, and the tail survives only in the summary.
- Instructions given to `/compact` reach the summarizer, but verbatim placement is not guaranteed. Rehydrate never depends on the pointer surviving.
- Checkpoints are plain markdown that the user can read or edit between save and rehydrate.
