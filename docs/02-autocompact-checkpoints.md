# 02 — Checkpoints at Claude Code's own compactions

_Status, 2026-11-04: BUILT as 0.4.0 and live in the author's setup, after the quality gate passed (DECISIONS.md, 2026-11-04 0.4.0). autoSave "boundary" is retired (0.3.2). Ryan, on "Build option 2 with the recs?": "go ahead and retire autosave" … "yeah update the local skill if the current one is worse"._

## Why

The automatic save of 0.3 runs a model turn before Claude Code compacts. That makes it race the engine and leaves two compactors in one session:

1. **It races the threshold.** The save turn costs about 12k tokens and must finish before the engine's point. In the boundary e2e of 2026-11-04, one large file read pushed past the save line, and the plugin compacted at 114k against a 117k point: 3k to spare.
2. **An engine compaction during a save still compacts twice.** The plugin's queued `/compact` runs at the turn's end over the fresh summary. 0.3.1 stops two of the plugin's own `/compact`s, not this. Verified in the code, not reproduced.
3. **After an engine compaction, the pointer can be stale and still win.** Every later compaction carries the last checkpoint's pointer however old, and rehydrate gives that checkpoint's standing rules and open decisions priority over the newer summary. Inferred from the skill text, not observed.

The engine's own compactions are where the losses are: 5 of 7 measured losses followed them. In the last 14 days, the author's sessions had 82 compactions, 23 of them the engine's. **13 of those 23 were precomputed** (the summary was built in the background and installed in 0 s); the other 10 ran on the spot in 87–142 s.

## Goal

Every compaction the engine starts gets a checkpoint as good as one `/smart-compact:save` writes: the same model, the same context, the same template and profile, and the same carry-forward guard and manifest measurement. No save turn in the main loop, no race and no guess about timing. Manual saves stay as they are, for deliberate boundaries.

## What the spike showed (2026-11-04)

A one-off plugin, in an SDK-mode session (`-p`, stream-json, like the desktop app), with the window forced to 150k:

- **`$.model.fork` works there.** At a turn's end it answered correctly in 9.9 s, served from the prompt cache (29k cache read).
- **It works inside an engine compaction.** Started inside `session.compact` (trigger `auto`) alongside `next(e)`, it finished with the engine's summary: 13.6 s for both, so it added nothing. It read 223k tokens from cache and saw the user's newest message.
- **`$.process.run` runs git** (with `DEVELOPER_DIR` set), and **`$.fs.write` writes a file** in default permission mode, creating its folders.
- **Not seen:** a `precompute` dispatch. The CLI did not precompute in this run, so that path is untested here.

A manual save turn in the double e2e made 5 requests over a 72–79k context, 382k context tokens in all. A fork makes one.

## Design

### The fork writes the checkpoint

At each engine compaction of the main conversation, the hook picks the checkpoint's path first, then starts `$.model.fork` and `next(e)` together. `$.model.fork` is the main thread's last request again, with tools denied and one prompt of ours appended. Its prompt carries:

- **The save instructions:** the save skill's checkpoint steps, rewritten for a writer without tools. Its output is the checkpoint text alone.
- **The template:** `skills/save/TEMPLATE.md`, and the profile's **Save** section.
- **The previous checkpoint, whole,** so the fork carries §1 and §2 forward, or settles items by name.
- **The pending ask, verbatim,** from `pendingAsk(e.messages)`, with its reply.
- **Disk facts.** These are what a manual save looks up with tools, gathered by the plugin beforehand:
  - the project root (the git top level of the files the session edited, else the working directory);
  - `git status --short`, `git log --oneline -5`, and the branch and HEAD;
  - the checkpoint folder's listing;
  - when the project has them, STATE.md's "Next action" and "Open questions" sections, the last three DECISIONS.md headings, and the newest HANDOFF file name.
  
  All of it is capped.

The compaction's instructions carry the new checkpoint's pointer, so the summary names the checkpoint about to be written. The pointer is then always the newest checkpoint, which removes problem 3.

### The same checks as the save tool

When the fork returns, the plugin runs what `compact_after_turn` runs on a manual save: parse, the carry-forward guard against `previous`, and manifest measurement. A refusal, or targets missing on disk, sends one more fork with the refusal text, as the tool's refusal does for a manual save, up to two retries. If it still fails, the plugin carries the dropped items into §1 and §2 verbatim, marked `carried by the plugin`, and writes the file. The frontmatter records `written_by: fork` with the attempt count.

### When it runs

- **Precompute (13 of 23):** the fork runs alongside the background summary, off the critical path. If the engine later discards that summary and computes again, the next dispatch forks again, and the unused checkpoint stays in the chain as `previous`.
- **On the spot (10 of 23):** the fork runs alongside the engine's summary, which takes 87–142 s on the author's sessions. It adds only the time it takes beyond the summary.
- **Gap after a precompute:** messages between the precompute and the install stay in context after the compaction but aren't in the checkpoint. At install, the plugin appends them verbatim, user messages only and capped, under "Since this checkpoint".

### When the fork can't run

`nothing-to-fork`, an API error or a timeout gives a plugin-written checkpoint instead: §1 and §2 carried from `previous`, the pending ask verbatim, the last user messages verbatim, and a manifest of the files most recently read or edited. It is marked `written_by: plugin (no model)`, and the notice says so.

### Fixes that come with it

- **An engine compaction cancels the plugin's own.** It clears a save's pending `/compact`, and a `/compact` already handed over is vetoed with `{ skip }` when it arrives. That fixes problem 2.
- **Rehydrate:**
  - the rule that the checkpoint wins over the summary applies only when the checkpoint is as new as the latest compaction;
  - a `written_by: plugin` checkpoint's carried items are to be checked against the summary.

### What goes

autoSave `boundary` (its code, option and e2e scenario), which removes problem 1. The author's setting goes back to `suggest`. The suggestion at `suggestAt` stays, because a manual save at a deliberate boundary is still the best checkpoint.

## Where it can still fall short of a manual save

- **No STATE.md or DECISIONS.md flush.** A manual save updates them first (step 1). A fork can't edit files, and the plugin shouldn't edit project files on its own.
- **No looking beyond the disk facts.** A manual save sometimes opens a file to check a claim before writing it down; in Buildable, it found STATE.md stale and refreshed it.
- **A precomputed checkpoint is a little behind.** The appended verbatim messages narrow the gap; nothing judged covers it.

## Verification

- **Unit tests:**
  - assembling the fork prompt, disk facts included;
  - the check-and-retry loop and its fallback;
  - the pointer in the instructions, on both `auto` and `precompute`;
  - the veto of the plugin's queued `/compact` after an engine compaction;
  - the appendix at install.
- **Quality A/B, the gate for "as good as manual".** One scripted session, run twice with a 150k forced window:
  - arm A: the user runs `/smart-compact:save` at about 100k;
  - arm B: no save; the engine compacts at 117k and the plugin forks.
  
  Both checkpoints are graded on the same rubric, built from the measured loss types:
  - standing rules, verbatim, with dates and scope;
  - open decisions, verbatim with recs and button labels;
  - approvals with their conditions;
  - task state that agrees with the rules;
  - manifest targets that exist and are measured;
  - carry-forward that passes.
  
  Most lines are checked mechanically, as `e2e_long.py` does. A judge for the rest runs headless with `--safe-mode` in a scratch workspace, never as a subagent, which would inherit memory and CLAUDE.md. **Pass: arm B scores at least arm A on every line, in 3 of 3 runs.**
- **Precompute:** untestable in `-p` if it never precomputes there, so it is verified in the author's sessions. The first precomputed engine compaction in a Buildable session is compared against that session's last manual checkpoint.

## Cost

One fork per engine compaction: a cache read of the transcript plus a few thousand output tokens (678 in the spike, with a trivial prompt), and up to two retries. In the e2e, a manual save turn read about five times the context in its five requests.

## Scope

- `hooks/register.ts`: the `session.compact` hook (fork, checks, write, veto) and removing the boundary branch.
- `hooks/autockpt.ts` (new): prompt assembly, disk facts, fallback writer and appendix, as pure functions.
- `hooks/ledger.ts` and `hooks/estimate.ts`: reused.
- `skills/rehydrate/SKILL.md`, `skills/save/SKILL.md` and `TEMPLATE.md`: the `written_by` rules.
- `.claude-plugin/plugin.json`: the option change, as 0.4.0.
- `scripts/e2e_long.py`: the A/B scenario.
- `README.md`, when it is pushed.

Estimated at one session, with the A/B.

## Decisions for Ryan

1. **Retire autoSave "boundary" entirely** (code, option and scenario), rather than keep it as an opt-in? Options: retire, keep opt-in. Rec: retire. Keeping it keeps the race and a second way to compact.
2. **Fork on a bare `/compact` you type, too?** Options: yes, engine compactions only. Rec: yes. It has the same gap (no checkpoint), and the plugin's own `/compact` from a save is the only one to skip.
3. **The STATE.md/DECISIONS.md flush.** Options: leave it to the main loop at handoffs; have the fork draft the updates into the checkpoint for the next turn to apply. Rec: leave it to the main loop. Project files changed by a background step, unasked, is the kind of thing to avoid. Your project-state discipline already refreshes them at handoffs.
4. **The quality gate:** arm B at least as good as arm A on every rubric line in 3 of 3 runs before it goes live in your setup? Options: that gate; 2 of 3. Rec: 3 of 3. "Just as good as manual" is the claim.
5. **Rollout:** build on `long-horizon`, commit locally only, and go live in your setup once the A/B passes. Options: that; wait for push. Rec: that. The push decision stays separate and unchanged.
