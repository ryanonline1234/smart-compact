---
name: save
description: High-fidelity alternative to a bare /compact. Checkpoints the session to disk, then compacts it automatically when the turn ends; rehydrating stays the user's choice (/smart-compact:rehydrate). Use when the user runs /smart-compact:save, says "smart compact", "save context" or "checkpoint the session", mentions context getting full or nearing the limit, or is about to run /compact on a session worth preserving. Not for handing work to another agent, and not a substitute for a project's own state files — this continues the SAME session past a compaction.
argument-hint: "[rebuild budget, e.g. 100k]"
---

# smart-compact: save

`/compact`'s summary is one generation, and it decides what survives. This plugin wraps it: **save to disk → compact → rehydrate (opt-in)**. Built for long-horizon work: many rounds of feedback, several compactions per session, decisions answered with "go with recs".

```
1. /smart-compact:save        SAVE      — checkpoint to disk; compaction queued for the end of this turn
2. (automatic)                WIPE      — the plugin runs /compact <pointer> when the turn ends
3. /smart-compact:rehydrate   REHYDRATE — the user's choice: read checkpoint + manifest → curated rebuild
```

**Rehydration is opt-in.** After a compaction, never rehydrate on your own, even when the summary carries a `CHECKPOINT:` line. (When the user has turned on `autoRehydrate`, the plugin runs `/smart-compact:rehydrate auto` itself after the compaction; don't run it yourself either way.) The user decides, by sending `/smart-compact:rehydrate`. If their next message is other work, do it from the summary and mention once, in one line, that `/smart-compact:rehydrate` would rebuild from the checkpoint, quoting the summary's "Rehydrate estimate at save" sentence when it has one.

**Every compaction carries a summary contract**, automatic ones included: the plugin adds instructions to keep standing rules, open numbered decisions with their recommendations, approvals with conditions, unfinished requests, iteration pointers and working methods. A save is still the high-fidelity path; the contract is the floor.

## Arguments

- None → save with the default 150k rebuild budget.
- A budget like `100k` or `80000` → that rebuild budget.
- Anything else → ask. A save run by mistake right after a compaction becomes the newest checkpoint and shadows the real one.

## Steps

0. **Guard and profile.** If this context is freshly compacted (a compact summary visible) and nothing new has happened since — no new instruction, answer, decision or work — confirm before saving: there is nothing to add. If anything new happened, save without asking; `previous` and the carry-forward check keep the earlier checkpoint's rules and open decisions. If `~/.claude/smart-compact/profile.md` exists, read it now: its **Save** section adds to these steps and wins where they differ.
   When Claude Code compacted on its own, the plugin already wrote a checkpoint for that compaction (the summary's `CHECKPOINT:` line names a `…-auto.ckpt.md`); a save now adds only what happened since, with that file as `previous`.
1. **Flush durable state first.** If the project keeps state files (a `STATE.md`, a `DECISIONS.md`, a changelog), update them now. Then promote standing rules that outlive this session to where Claude Code re-injects them after every compaction: the project's `CLAUDE.md` or rules doc, or auto memory. The cheapest thing to rehydrate is something that never left. The checkpoint records only what no file on disk can.
2. **Paths.** Key the checkpoint by the **project**, not the shell: desktop sessions often run with `pwd` at `/`, which would file every project's checkpoints together. `ROOT` is the git top level of the project this session works on (the directory holding the files you edited), else that directory:
   ```bash
   ROOT=$(git -C <project dir> rev-parse --show-toplevel 2>/dev/null || echo <project dir>)
   SLUG=$(printf %s "$ROOT" | sed 's|[^A-Za-z0-9]|-|g')
   CKPT_DIR="$HOME/.claude/checkpoints/$SLUG"; mkdir -p "$CKPT_DIR"
   PREV=$(ls "$CKPT_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$' | sort -r | head -1)
   TASK=<3-6 kebab words naming the task, [a-z0-9-] only>
   CKPT="$CKPT_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$TASK.ckpt.md"
   ```
   `previous:` in the frontmatter is `$CKPT_DIR/$PREV` when `PREV` is set, else `none`.
3. **Write the checkpoint** to `$CKPT` following [TEMPLATE.md](TEMPLATE.md):
   - **§1 Standing rules and §2 Open decisions first, and complete.** Read `previous` (when set) and carry every rule and every open decision forward; a `previous` marked `written_by: plugin` carries items no model judged, so settle any the conversation settled. Drop one only by writing it as `retired: …`, `answered: …` or `promoted to <file>: …`. The tool refuses a checkpoint that silently drops one.
   - **§2 verbatim:** copy the latest numbered questions exactly as you asked them, with options and each recommendation, so a later "go with recs" resolves to the same list. Record each approval with its conditions.
   - **§3 must agree with §1.** If the task state still says something a later rule overrode ("Ryan tests on preview" after "Claude tests its own work"), fix §3.
   - **The next action is the first unfinished item of §3's plan,** approved work that has not run included: an approved deploy, test or merge is next work, not background. When it waits on the user's answer, say so and name what can run meanwhile. The frontmatter `next_action` is the same line.
   - **Refer to the user by name or as "they":** their pronouns are not stated, so never he/him/his or she/her.
   - **Only the user settles a question put to them.** Something you did on your own (promoting a rule you offered to save, choosing for them) is not an answer: carry the question as open. An `answered:` line quotes the user's words; the tool refuses one that doesn't.
   - Dense and factual. No narrative recap of the conversation's journey. `file:line` pointers instead of file contents, except in the verbatim vault.
   - **Never duplicate what's already on disk** (state files, CLAUDE.md, git history, committed code): the manifest re-reads it instead.
   - **Redaction outranks byte-exactness**, inside the vault too: credentials become `<REDACTED:kind>` plus a transcript grep pattern.
   - **§7 manifest:** keep the template's table shape, one item per row. Prefer `path#Heading` sections and `path#last N` log entries to whole files; never list CLAUDE.md, rules files or memory (re-injected). Relative paths resolve against `project_root`. The plugin parses this table to measure the estimate.
   - Manifest budget: default **150k** tokens; the argument overrides; cap at about 50% of the model's context window. Estimate prose ≈ chars/2.7 and code ≈ chars/2.5 (measured on Claude 5 models, within 12% per file).
4. **Prune**, keeping the newest 10 by filename. Only files this skill wrote are moved, into `archive/`, never deleted:
   ```bash
   mkdir -p "$CKPT_DIR/archive"
   ls "$CKPT_DIR" | grep -E '^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+\.ckpt)?\.md$' | sort -r | tail -n +11 \
     | while read -r f; do head -14 "$CKPT_DIR/$f" | grep -q '^rebuild_budget:' \
         && mv "$CKPT_DIR/$f" "$CKPT_DIR/archive/$f"; done
   ```
   Two locks: the name pattern and the `rebuild_budget:` frontmatter marker. The directory can hold look-alike files this skill didn't write; never touch those. List anything archived in the report.
5. **Compact.** The instructions are one line, with `<8-word task summary>` and the `$CKPT` path substituted and every other word verbatim:
   `The summary must contain, verbatim: "Task: <8-word task summary>. CHECKPOINT: <absolute $CKPT path>. Rehydrate from it only when the user sends /smart-compact:rehydrate."`
   - **Auto (default).** Load `mcp__smart-compact__compact_after_turn` with ToolSearch (`select:mcp__smart-compact__compact_after_turn`) and call it with `instructions` = that line and `checkpoint` = the absolute `$CKPT` path. If it refuses because the checkpoint drops items from `previous`, carry or settle each one it names and call it again. If it answers "Already queued", a compaction from an earlier turn has not run yet and takes this checkpoint: queue nothing more, and say so in the report. Its result carries a `Measured:` rehydrate estimate and flags §7 targets that are missing or past the budget; fix those and call it again if they matter. Then write step 6's report and end the turn. Start no other work in this turn: the compaction runs as soon as it ends.
   - **Manual** (the tool does not load or refuses for another reason). Print `/compact ` + that line in a copyable code block, then the standalone line `CHECKPOINT: <absolute $CKPT path>` outside the block, then: *"Paste that. Afterwards, send `/smart-compact:rehydrate` when you want the rebuild. Work done after this save is not in the checkpoint."*
6. **Report:** the checkpoint path and size; how many standing rules and open decisions it carries, and how many came from `previous`; how the compaction happens; the tool's `Measured:` sentence as the rehydrate estimate (rehydrating is the user's call); anything archived.

**Late save (≥85% of the window):** delegate the write to a fork (a fork inherits this conversation; a plain subagent does not): "Write the checkpoint for this session to $CKPT per TEMPLATE.md, carrying §1 and §2 forward from $PREV; return only the path and byte count." Call the tool only once the fork's completion arrives, from the main thread.

## Notes

- **Compactions this skill did not start** (Claude Code's own at its threshold, a precomputed one, a bare `/compact`) get a checkpoint too: the plugin asks a fork of the main thread (the same model over the same transcript, tools denied) to write one by these same steps and template, checks it with the same carry-forward guard and manifest measurement, and corrects or repairs it. The session stays the same session; the fork's answer goes only to the file. Option `checkpointOnCompact` (default on).
- The plugin's hooks module supplies the tool and the summary contract. It runs `/compact` as if the user typed it, because the mod API's direct compact call is refused in SDK hosts such as the desktop app. After compaction it shows what rehydrating would add, measured on disk before the wipe, minus files compaction already put back.
- The contract comes from the **Summary contract** section of the profile when there is one, else a built-in default.
- Instructions given to `/compact` reach the summarizer, but verbatim placement is not guaranteed. Rehydrate never depends on the pointer surviving.
- Checkpoints are plain markdown that the user can read or edit between save and rehydrate.
