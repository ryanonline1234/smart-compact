# State

**Version:** 0.5.1 on local branch `long-horizon`, **committed locally, not pushed**. 0.4.0 (checkpoints at Claude Code's own compactions), plus 0.5.0's manual-save fixes and settings (a save band the model offers, `autoRehydrate`), plus 0.5.1: the fork retuned and re-gated, and the save offer made restart-proof. Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** a snapshot at `~/.claude/smart-compact/plugin`, outside this checkout, made by `scripts/install-live.sh [ref]` (default `long-horizon`; `.snapshot` there names the commit). `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` points at it. Options under `pluginConfigs["smart-compact@inline"]`: `suggestFrom: 600000`, `suggestTo: 700000`, `autoRehydrate: "always"`. **Merging is no longer deploying:** run the script after a merge to go live. Settings backups: `.pre-smart-compact-0.2.bak`, `.pre-autosave.bak`, `.pre-retire-autosave.bak`, `.pre-0.5-settings.bak`, `.pre-live-snapshot.bak`. Profile: `~/.claude/smart-compact/profile.md`. A/B results: `~/smart-compact-runs/`.

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

**Verified (2026-11-05, 0.5.1):**
- **Checks:** 109 unit tests pass, `claude plugin validate` passes, the type check is clean, and a fresh session loads 0.5.1.
- **The re-gate**, `--scenario ab --runs 5` on Opus 5.5, with criteria fixed before the run:
  - A: the fork matched or beat the manual save on every rubric line in 5 of 5 pairs (needed 4 of 5).
  - B: the blind judge, each checkpoint scored against its own session, gave the fork 106 and the manual save 100, out of 125 (needed at least 95).
  - The fork called the user "he/his" in 1 of 5 runs, down from 3 of 3. The manual save still did in 2 of 5, despite the skill's new line.
  - Results are in `~/smart-compact-runs/regate`.
- **The offer survives a restart:** in a test session offered once, then resumed in a new process, 0.5.0 offered again (control) and 0.5.1 did not. The record is in `~/.claude/plugins/store/smart-compact_inline-*.json`.
- **The offer waits for the user's own prompt:** origin composer, sdk or bridge only. `prompt.submit` was measured to run before the classic hook. The peer case itself is not tested end to end, because `-p` cannot send a peer message.

**Not verified end to end:** a fork-written checkpoint in a real session; the precompute path; `autoRehydrate always` after an engine compaction (unit tests only).

**Next:** watch the first 600k–700k offer and the automatic rehydrates in a real session. The live install moved to a snapshot outside the checkout on 2026-11-05: sessions opened before the move still load from `~/smart-compact` and keep hot-reloading on its commits until they are reopened. Later: decide whether to push to the public repo and update the site (it describes 0.1).

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior.
