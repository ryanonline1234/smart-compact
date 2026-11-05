# State

**Version:** 0.4.0 on local branch `long-horizon`, **committed locally, not pushed**. It builds on 0.2 "long-horizon", pending-list capture, one compaction at a time (0.3.1) and the automatic save's retirement (0.3.2), and adds checkpoints at Claude Code's own compactions (`docs/02-autocompact-checkpoints.md`). Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** loaded from this working copy via `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, options under `pluginConfigs["smart-compact@inline"]`: `suggestAt: 400000`; `checkpointOnCompact` unset, so on by default. Backups: `settings.json.pre-smart-compact-0.2.bak`, `settings.json.pre-autosave.bak`, `settings.json.pre-retire-autosave.bak`. Profile: `~/.claude/smart-compact/profile.md`. Branch `fork-checkpoints` holds the build history; worktree `~/smart-compact-fork` removed after the merge.

**How it behaves now:**
- **`/smart-compact:save`** writes a checkpoint and compacts, as before; a suggestion comes once past 400k.
- **Every compaction it did not start** (Claude Code's own, precomputed ones, a bare `/compact`) gets a checkpoint written by a fork of the session. The fork works alongside the summary and is checked like a save. A plugin-written checkpoint stands in when no fork can run.
- **An engine compaction cancels a save's own `/compact`,** or vetoes it if it was already handed over.
- **Every compaction** carries the summary contract and the pending decision list verbatim.

**Verified (2026-11-04, 0.4.0):**
- **Checks:** 83 unit tests pass, `claude plugin validate` passes, the type check is clean, and a fresh session loads 0.4.0 with both commands and the queue tool.
- **The spike:** `$.model.fork` works in an SDK-mode session, and inside an `auto` compaction at no added time.
- **The A/B gate, `--scenario ab`:** 3 pairs on Opus 5.5 with a 150k forced window.
  - The fork matched the manual save on all 9 rubric lines in 3 of 3 pairs, so it passed.
  - The first gate run failed 2 of 3. The cause was a matcher bug, shared by the grader and the plugin's carry check, and fixed with a test that fails on the old code.
- **The blind judge:** each checkpoint scored against its own session, tool calls included. The fork was at least as high as the manual save on rules, decisions, task state, next action and manifest in all three pairs; summed, fork minus manual is +3, +1, 0, +4, +2. One sample per checkpoint, and the judge's input took four versions to get right (DECISIONS.md).

**Not verified end to end:** the precompute path (unit tests only; `-p` did not precompute); the fork's cost on a 1M-token session.

**Next:** watch the first engine compaction in a real session, ideally a precomputed one in Buildable. Compare its `…-auto.ckpt.md` with that session's last manual checkpoint, and note the time and cost of the fork. Then decide whether to push to the public repo and update the site, which describes 0.1. To redeploy the site: `cd site && vercel deploy --prod --yes`, after deleting any `.env.local`.

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior; tell the fork that, after an in-flight request, open questions to the user come before work that depends on them (one judged pair found the fork planning to build before the answers).
