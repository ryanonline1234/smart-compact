# State

**Version:** 0.6.0 on local branch `long-horizon` (02ca3a5), **committed locally, not pushed**, and live as the author's snapshot since 2026-11-06. 0.4.0 (checkpoints at Claude Code's own compactions), plus 0.5.0's manual-save fixes and settings (a save band the model offers, `autoRehydrate`), plus 0.5.1: the fork retuned and re-gated, and the save offer made restart-proof, plus 0.6.0: the pending list held across compactions until the user answers it. Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

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

**0.6.0 (2026-11-06, built on branch `capture-persist` by the side session, fast-forwarded into `long-horizon` at 02ca3a5 and installed live on Ryan's "Go ahead merge and install"):** the pending decision list is held in the session's store record until the user answers it, and supplied at every compaction (marked as carried once it has left the conversation, with the user's messages since). An approval, a button label or a pick by number ends the hold after one more compaction; so do 7 days, 20 messages without an answer, or a newer list. The compaction fork gets the held list too. `SMART_COMPACT_TRACE` (off unless set) writes each compaction's final instructions to a folder.
- **Checks at 02ca3a5:** 131 unit tests pass, `claude plugin validate` passes, the type check is clean (re-run by the main session on a clean copy), and a fresh session loads 0.6.0 from the snapshot.
- **Fixed after the gate, unit tests only:** user prompts that begin with `<system-reminder>` blocks (8 of 240 prompts across the author's last 40 sessions) count as the user's own, in the hold, `pendingAsk`, `turnState`, `userMessages` and `boundarySince`; the 20-message cap applies to a list still in the conversation too; a pick by number needs a pick verb, `#`/`option`, two numbers or a bare number.
- **Gate (`docs/06`, pre-registered):** `--scenario persist --runs 3`, 0.5.1 against 0.6.0, three automatic compactions per run. Persist delivered the list verbatim at every compaction in 3 of 3 runs; no regression (9 vs 9 lines verbatim, 3 vs 3 rules, 3 vs 3 resolved by a blind judge). Not an outcome gain: the summary chain alone kept the list in this scenario.
- **Unit tests only:** the fork receiving the held list; the hold surviving a restart.

**Not verified end to end:** a fork-written checkpoint in a real session; the precompute path; `autoRehydrate always` after an engine compaction (unit tests only).

**Presentation (2026-11-05, side session):**
- **README:** leads with "enforcement for Claude Code's compaction", with dated prior art, the contract A/B at 3 runs per arm, Read-tool token figures compared with Claude Code's own 3 bytes/token, the +0.5% explained as errors cancelling, the 0.5.1 fork numbers, and "kept is not followed".
- **site/:** updated for 0.5.1, with "What survives" and "Prior art" sections; the motion check passes 71/71. **Not deployed:** the live site still shows 0.1.
- **New docs:**
  - `docs/03` novelty survey: the guard and pending-list capture were not found elsewhere; the rest pairs prior art with a new last step.
  - `docs/04` placement experiment: pre-registered, inconclusive. A follow-up showed the `after` arm did deliver at the first compaction. The real gap: capture looks back only six user messages, so after the first compaction a pending list survives only through the summary chain. Built in 0.6.0 (`docs/06`), merged and live.
  - `docs/05` reproducible session study, with `scripts/sessions_study.py`. The population and the "go with recs" finding reproduce. A loss re-judge (`scripts/loss_judge.py`, clean headless judges) found 1 and 2 of 47, but missed at least one clear loss, so no rate is cited (4–20%).
- **Branch `placement-exp`** holds the experimental `pendingAskPlacement` code, not merged.

**Next:** watch the first 600k–700k offer, the automatic rehydrates, and a pending list held past a second compaction in a real session. The live install moved to a snapshot outside the checkout on 2026-11-05: sessions opened before the move still load from `~/smart-compact` and keep hot-reloading on its commits until they are reopened. Later: decide whether to push to the public repo and deploy the reworked site (`site/` is updated for 0.5.1; the live site still shows 0.1).

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior.
