# Decisions

Append-only. Each entry: the decision, then why.

## 2026-11-03

- **Run `/compact` through `$.command.run`, scheduled with `$.clock.after`, not `$.session.compact`.** SDK hosts refuse `$.session.compact` ("not available in a headless (-p / SDK) session yet"), and the desktop app runs every session in stream-json SDK mode. A command run from inside a hook the turn waits on is refused, hence the timer.
- **Rehydration is opt-in, enforced with `disable-model-invocation: true`.** The user asked to choose when to rebuild. An instruction alone left the model free to auto-rehydrate after compaction.
- **Two namespaced commands, `/smart-compact:save` and `/smart-compact:rehydrate`.** Plugin skills are always prefixed with the plugin name. One skill with a mode argument would read `/smart-compact:smart-compact rehydrate`.
- **Measure the manifest at save time with 2.73 (prose) and 2.49 (code) characters per token.** Calibrated on seven files on Sonnet 5.5 and Opus 5.5, which counted identically: within 12% per file, +0.5% in total. The earlier 4 and 3.2 undercounted by 1.3–1.5×.
- **Find re-attached files in the transcript.** Compaction writes `file` and `compact_file_reference` attachment rows without raising `session.append`, and they are absent from `session.compact`'s result. The transcript path comes from any classic hook event's `transcript_path`.
- **Report the engine's before/after counts, labelled; no live window total.** `post_tokens` leaves out the system prompt and tool definitions. `/context`'s local estimate read right after compaction gave 43k in one run and 91k in the next, against about 76k real.
- **Suggest saving at a threshold; never auto-save.** A save needs a model turn. Auto-submitting one would interrupt work, and in an unattended session it would stall at the opt-in rehydrate.

## 2026-11-04

- **Host the site on Vercel with no Git link, deployed from `site/` by CLI.** A Git-connected project would deploy the repo root on every push. The project was created with `vercel project add` first, because the CLI silently connects Git when it creates a project non-interactively. `site/.vercelignore` keeps `.env*` and `.vercel/` out of uploads; the CLI's `vercel link` writes a `.env.local` holding a Vercel OIDC token.
- **Commits use the GitHub no-reply address.** The repo is public, and a personal address in commit metadata would be published with it.

## 2026-11-04 (0.2, long-horizon)

- **Every compaction carries a summary contract, automatic ones included,** via the `session.compact` hook rewriting `instructions`. Measured on the author's sessions: 5 of 7 post-compaction losses followed automatic compactions, 16 of 17 automatic compactions were in sessions that never saved, and all 15 with timing data fired mid-turn (threshold, not idle). A save can't reach those; the contract can. In a forced auto-compaction A/B, the contract kept 3 of 3 open questions with recs, the control 0 of 3.
- **Precomputed compactions get the contract too.** Their result can be installed by a later compaction, so instructions must be in place when they are computed.
- **Key checkpoints by the project's git root.** 13 of 36 checkpoints sat in the root slug `-` because desktop sessions run with pwd `/`.
- **A carry-forward guard refuses, rather than warns.** A warning lets the turn end and the compaction run with the gap. Word-overlap matching (60% of the item's words, metadata ignored; a settled item may match by its first sentence) keeps the refusal satisfiable by copying or retiring by name.
- **Standing rules and open decisions first, and they override the task state.** A rehydrate on 2026-10-30 restored a rule in the directives section while the task state still contradicted it, and the stale line won.
- **Profile as a file, not options.** The contract and the per-user save/rehydrate habits are prose; a markdown file at `~/.claude/smart-compact/profile.md` (override `SMART_COMPACT_PROFILE`) holds them, re-read at every compaction.
- **The suggestion caps at 60% of the auto-compaction point.** Automatic compactions fired from 204k to 970k depending on the model's window, so a fixed token number alone fires too late on small windows.

## 2026-11-04 (adaptive: proposal items 1 and 2)

- **Capture the pending list mechanically, from the compaction event's own messages.** The contract alone already kept 3 of 3 question lines verbatim in the forced tests, so capture shows no gain there; it is a guarantee for what the test does not stress: a list several turns back in a 900k session, questions asked with buttons (the app's next-step box, AskUserQuestion), and the user's reply quoted with it. It looks back up to six user messages because a save-triggered compaction runs a turn after the list.
- **Automatic save at the turn boundary, opt-in (`autoSave: boundary`).** 13 of 17 automatic compactions fired on the user's next message; the turn before had ended just under the limit. Saving at that turn's end costs a model turn but no waiting, since the user is reading. Started with `$.command.run('smart-compact:save', 'auto')` from a timer, like `/compact`. Once per stretch; a compaction or the user's own message (origin composer, sdk or bridge) re-arms it.
- **"Near" is min(85% of the auto point, the point minus 25k).** The save turn cost about 12k tokens in the forced run (103k → 115k against a 117k point); a fixed share leaves too little on small windows.
- **The auto-compaction point is read at the first turn's end and every 10th turn,** not once past 20% of the model window. Bug found end to end: a 150k session on a 1M model never asked, and fell back to 85% of 1M.
- **The `auto` save abandons itself if the user writes during it.** Otherwise the save turn would absorb a reply like "go with recs" and the session would then idle on a compaction.

## 2026-11-04 (0.3.1: one compaction at a time)

- **The queue tool answers "Already queued" while a `/compact` it handed over has not run, rather than queuing a second.** Seen in the first real automatic save (a Buildable session): a `/smart-compact:save` typed during it ran between its turn end and its `/compact`, because a slash command waits for the turn to end and the plugin hands `/compact` over 100 ms later, to run when the session is idle. That save reused the checkpoint and queued again, and both ran, the second over a 40k summary. Reproduced end to end: two compactions, the second 23.7k → 26.8k. A refusal (deny) was rejected: the second save did nothing wrong, and a refusal reads as something to fix.
- **A newer checkpoint rides on the waiting compaction,** its instructions swapped in `session.compact`: the waiting `/compact` cannot be cancelled, and its pointer would name the older checkpoint.
- **No automatic save or suggestion while a compaction waits.** A message typed meanwhile re-arms autoSave, and a save at that turn's end would queue a second compaction.
- **A waiting `/compact` counts as dropped after 3 main turns.** Whether `$.command.run` settles when the engine drops a queued command is unverified; without a bound, a lost one would block every later save in the session.
- **The e2e forces the second queue call** instead of sending a second `/smart-compact:save`. Sonnet 5.5 and Opus 5.5 both declined a plain second save in tests (nothing new), so a plain one tests the model, not the plugin. Plain text sent mid-turn joins the running turn, so the call is sent at the save turn's end.

## 2026-11-04 (0.3.2: the automatic save retired)

- **autoSave "boundary" is removed: its code, option, skill argument and e2e scenario** (Ryan: "go ahead and retire autosave"). A save turn has to start and finish before the engine's threshold, so it races it. In the e2e it compacted at 114k against a 117k point. In the first real session it led to a double compaction, and an engine compaction during a save still could. Two compactors in one session is the defect; timing tweaks only narrow the race. Checkpoints at the engine's own compactions are to come from `docs/02-autocompact-checkpoints.md` instead, with no model turn in the main loop.
- **The suggestion stays, and `suggestAt: -1` now turns it off** (`autoSave: off` did before). A manual save at a deliberate boundary is still the best checkpoint.

## 2026-11-04 (0.4.0: checkpoints at Claude Code's own compactions)

- **A fork of the main thread writes the checkpoint** (`$.model.fork`: the same model over the same cached transcript, tools denied), not the plugin from the transcript alone. Ryan's bar was "just as good quality as if it was manual", and only the same model reading the same context can meet it. The answer goes only to the file, so the session stays the same session. The spike showed it working in an SDK-mode session and inside an `auto` compaction, alongside the summary at no added time.
- **What a save looks up with tools, the plugin gathers first** (git state, the state files' next action and open questions, earlier checkpoints, the newest handoff), and the fork gets the save skill's own write step, the template and the profile. **The same checks as a manual save follow:** carry-forward and manifest measurement, two corrections through `$.model.complete` with the refusal text, then the plugin carries what is still dropped, verbatim and marked. A refusal can't simply be passed back to the fork, as the tool does for a save: after the compaction, the fork would see the new transcript.
- **A plugin-written checkpoint is written first, before the summary.** The summary's pointer then always leads to a file, even when the fork never lands (`nothing-to-fork`, an API error, an interrupt).
- **Precomputed summaries get one fork, at the precompute, and the user's later messages appended at install.** A reused summary ignores the instructions given at install, so its pointer is the precompute's. 13 of the author's 23 engine compactions in 14 days were precomputed.
- **An engine compaction cancels a save's pending `/compact`, and vetoes one already handed over** (`{ skip }`). That was the double-compaction path 0.3.1 left open.
- **The gate:** the fork had to match a manual save on every rubric line in 3 of 3 A/B pairs. The first run failed, 2 of 3, on "earlier decisions carried". The supposedly missing item was there as `answered: Deploy main with round 5 now?`: the matcher cut the question at the first "? ", and in `**Deploy …?** Rec` it ends at "?**". The plugin's carry check had the same bug. Both are fixed, with a test that fails on the old code, and the line now compares each arm with its own earlier checkpoint. A fresh run passed 3 of 3. The first gate's result was kept, not re-scored.
- **The blind judge took four versions, each fixing an input defect, never the scoring.** v1 compared both arms against the manual arm's session. v2 lacked the user's messages, which the stream log doesn't echo. v3 lacked tool calls, so a manual save's own file edits looked invented. v4 uses Claude Code's transcript, both sides and tool calls, up to each checkpoint's compaction, blind to `written_by`. On v4 the fork scored at least as high on every dimension in every pair. It is one sample per checkpoint, and the judge can't see the profile, so it marks down the manual save's profile-driven flushes.
- **Live in the author's setup on that evidence** (Ryan: "update the local skill if the current one is worse"). The change is additive: manual saves are unchanged, and an engine compaction used to get no checkpoint at all. Remaining gaps: no state-file flush, and the precompute path untested end to end.

## 2026-11-05 (0.5.0: the manual save's three fixes; settings)

- **The next action is the first unfinished item of the plan, approved work included; only the user settles a question; the manifest must cover what the session changed.** These come from the blind judge's findings on 0.4.0's manual saves (Ryan: "Go with recs"). The queue tool refuses an `answered:` line that settles an open question without the user's words. It names files the manifest leaves out that changed through Edit/Write or are left uncommitted in git. Git is needed because the save's own state-file flush often runs through Bash, which no Edit call shows; the first version missed exactly the case the judge flagged.
- **Measured before against after, same harness, 3 runs each:** the next-action line went 0/3 → 3/3, manifest coverage 0/3 → 2/3, and the quote line stayed 3/3. The judge was flat (64 → 65 of 75), and a save costs about 0.8k tokens more. The quote check showed no gain because saves already quoted; the habit it targets (settling what the user didn't answer) still shows in other forms.
- **The fork now trails the improved manual save:** 2/3 gate pairs, and a judge score of 60 against 65. It went live anyway. The change is additive to 0.4.0's fork, and its rubric lines did not get worse. The tuning is a proposed follow-up.
- **The save offer comes from the model** (classic UserPromptSubmit `additionalContext` on the user's next message). The desktop app shows no prompt suggestion, and a transcript line is easy to miss. Ryan: "automatically suggests smart-compact:save within the range of 600k-700k token and make it variable between sessions". The band fires right after a round closes (cheapest place to compact: 20 of 58 compactions), else at its top, so the point varies with each session's work; it stays below 90% of the engine's point. Random or per-session points were the other readings of "variable"; neither was built.
- **`autoRehydrate` (off | after-save | always) replaces the opt-in-only rule of 2026-11-03,** on Ryan's "I can turn auto rehydrate on". His setting is `always`. The rehydrate skill's `auto` mode asks nothing and starts no work. After an engine compaction on the user's next message, that message is answered from the summary first.
- **Harness lessons, each a lost or wasted run:**
  - `git worktree remove` deleted the ignored `scripts/out` holding a gate's results; results now go to `SC_OUT`.
  - Concurrent A/B runs matched each other's checkpoint folders by a name suffix; they now match the exact slug.
  - A manual save at 88k crossed the 117k point once save turns grew; it now starts at 75k, and invalid arms are marked.

## 2026-11-05 (0.5.1: the fork retuned and re-gated; the offer made restart-proof)

- **The fork gets where the turn stood as a fact** (the user's latest message verbatim, and the calls since it, returned or not), **and four named corrections**: name the user or say "they"; a returned call is done; finish an interrupted reply, then the first unfinished plan item with approved work included; keep every approval's conditions whole. These target the judge's repeated errors on the 0.5.0 fork (Ryan: "Tune and re-gate").
- **The gate's criteria were set before the run, and correctness comes first.** The side session's novelty report argued that fork against manual on my own rubric "measures consistency rather than correctness". So: A, the fork matches or beats manual on every rubric line in at least 4 of 5 pairs; B, the blind judge, which scores each checkpoint against its own session, rates the fork's total no more than 5 below manual's. Five pairs instead of three, because judge noise ran about 3 points. Result: A 5/5, B fork 106 against manual 100 of 125. Live on that.
- **The save offer's state lives in `$.store`, keyed by session id.** In two desktop sessions the offer came twice with no compaction between. The plugin docs say an interactive session hot-reloads its plugin folder, and that a lost hooks worker restarts the module "its timers and state gone". A resumed session reproduced the repeat on 0.5.0 and not on 0.5.1. The record also keeps the latest checkpoint pointer, which a restart used to drop as well.
- **The note is delivered only with the user's own prompt** (origin composer, sdk or bridge): it once arrived with a cross-session message. Past the band's top, the note says "past the top of".
- **Coordination with the side session** (local_aca6ee56, novelty report, branches `presentation` and `placement-exp`): disjoint files, its commits held during the gate, its README and docs/03 numbers refreshed from this gate.

## 2026-11-05 (the live install moves to a snapshot)

- **The live plugin is a snapshot of one commit at `~/.claude/smart-compact/plugin`, refreshed by `scripts/install-live.sh`,** not this git checkout (Ryan: "Yes, move it"). The docs say an interactive session hot-reloads the folder it loads a plugin from, and a reload starts the hooks module over, losing timers and any fork writing a checkpoint. Every commit, worktree and rebase writes into the checkout's `.git`, and two sessions were committing all day. The script syncs by checksum, so an update writes only changed files.
- **Not in `~/.claude/mods`,** which loads on its own, so the plugin would load twice. **Merging is no longer deploying:** going live is a deliberate run of the script.

