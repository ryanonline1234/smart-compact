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
