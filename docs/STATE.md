# State

**Version:** 0.3.2 on local branch `long-horizon`, **committed locally, not pushed**. That is 0.2 "long-horizon", adaptive item 1 (pending-list capture), one compaction at a time (0.3.1), and the automatic save retired (0.3.2). Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** loaded from this working copy via `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, options under `pluginConfigs["smart-compact@inline"]`: `suggestAt: 400000`; `autoSave` removed 2026-11-04. Backups: `settings.json.pre-smart-compact-0.2.bak`, `settings.json.pre-autosave.bak`, `settings.json.pre-retire-autosave.bak`. Profile: `~/.claude/smart-compact/profile.md`. The pre-plugin skill and mod are in `~/Archive/` (logged in `~/Archive/CLEANUP-LOG-2026-10-11.txt`).

**How it behaves now:**
- **Checkpoints are written only by `/smart-compact:save`,** with a suggestion once past 400k.
- **Every compaction, Claude Code's own included,** carries the summary contract and the pending decision list verbatim.
- **One `/compact` at a time:** a second queue call while one waits answers "Already queued".

**Verified:**
- **2026-11-04, 0.3.2:**
  - 62 unit tests pass;
  - `claude plugin validate` passes;
  - the type check is clean.
- **Earlier, still standing:**
  - `scripts/e2e_long.py`'s automatic-compaction A/B: with the contract on, 3/3 open questions and recs were kept; with it off, 0/3.
  - The two-save scenario: keyed by project root, carry-forward, the conditional approval recorded.
  - `--scenario double`: two compactions on 0.3.0, one on 0.3.1.

**Retired in 0.3.2: autoSave "boundary"** (the automatic save at a turn's end). The first real one, in a Buildable session, worked but led to a double compaction. More basically, a save turn races the engine's threshold: in the e2e it compacted with 3k to spare. DECISIONS.md has the reasoning.

**Next:** build `docs/02-autocompact-checkpoints.md`, in which a `$.model.fork` writes a checkpoint at each compaction Claude Code starts. Build it in a separate worktree. It goes live in the author's setup only if its checkpoints match manual ones on every rubric line, in 3 of 3 A/B runs. Later: decide whether to push to the public repo; then update the site (it describes 0.1) and redeploy with `cd site && vercel deploy --prod --yes` after deleting any `.env.local`.

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior.
