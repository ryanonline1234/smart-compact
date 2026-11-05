# State

**Version:** 0.5.0 on local branch `long-horizon`, **committed locally, not pushed**. 0.4.0 (checkpoints at Claude Code's own compactions) plus the manual-save fixes from the blind judge's findings and the settings Ryan asked for: a save band the model offers, and `autoRehydrate`. Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** loaded from this working copy via `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. Options under `pluginConfigs["smart-compact@inline"]`: `suggestFrom: 600000`, `suggestTo: 700000`, `autoRehydrate: "always"`; `checkpointOnCompact` on by default. Backups: `settings.json.pre-smart-compact-0.2.bak`, `.pre-autosave.bak`, `.pre-retire-autosave.bak`, `.pre-0.5-settings.bak`. Profile: `~/.claude/smart-compact/profile.md`. A/B results live in `~/smart-compact-runs/` (outside any worktree).

**How it behaves now:**
- **Inside 600k–700k**, Claude offers `/smart-compact:save` in its next reply, at the first turn end after a commit, merge, deploy or state-file write, or at 700k at the latest. The band stays below 90% of the session's own compaction point.
- **`/smart-compact:save`** writes a checkpoint and compacts. The queue tool refuses an `answered:` line that doesn't quote the user, and names files changed this session (Edit/Write, or uncommitted in git) that the manifest leaves out.
- **After every compaction** with a checkpoint, the plugin runs `/smart-compact:rehydrate auto` (autoRehydrate always). It asks nothing and starts no work.
- **Every compaction the plugin did not start** gets a checkpoint written by a fork of the session. Every compaction carries the summary contract and the pending list.

**Verified (2026-11-05, 0.5.0):**
- **Checks:** 102 unit tests pass, `claude plugin validate` passes, the type check is clean, and a fresh session loads 0.5.0.
- **E2E `--scenario settings`:** after a commit inside a test band, the model answered "What is 2 + 2?" with the answer plus an offer of `/smart-compact:save`. A save then compacted once and rehydrated on its own.
- **Manual save, before (0.4.0) vs after (0.5.0)**, 3 runs each with the fixed harness:
  - next action includes the approved work: 0/3 → 3/3;
  - manifest covers files changed this session: 0/3 → 2/3;
  - answered lines quote the user: 3/3 → 3/3;
  - the 9 other rubric lines: full in both;
  - blind judge: 64 → 65 of 75;
  - save turn: 11.9k → 12.7k tokens on average.
- **The fork arm on 0.5.0:** the gate passed 2 of 3 pairs. It failed on "next action includes approved work" in one pair, a line the improved manual save now passes. Blind judge: 60 of 75 for the fork, against 65 for the manual save (67 for the fork in the 0.4.0 gate). The fork's repeated errors were calling the user "he/his" (3/3) and calling an in-flight read not done.

**Not verified end to end:** a fork-written checkpoint in a real session; the precompute path; `autoRehydrate always` after an engine compaction (unit tests only).

**Next:** watch the first 600k–700k offer and the automatic rehydrates in a real session. Proposed: tune the fork (name the user or say "they"; a call made with its reply still pending is in flight, not "not done"; finish it, then the first unfinished plan item), then re-run `--scenario ab` until the fork matches the manual save again. Later: decide whether to push to the public repo and update the site (it describes 0.1).

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior.
