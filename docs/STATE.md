# State

**Version:** 0.3.0 (0.2 "long-horizon" plus adaptive items 1 and 2), on local branch `long-horizon`, **committed locally, not pushed**. Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** loaded from this working copy via `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (backups: `settings.json.pre-smart-compact-0.2.bak`, `settings.json.pre-autosave.bak`), options under `pluginConfigs["smart-compact@inline"]` (`suggestAt: 400000`, `autoSave: boundary`). Profile: `~/.claude/smart-compact/profile.md`. The pre-plugin skill and mod are in `~/Archive/` (logged in `~/Archive/CLEANUP-LOG-2026-10-11.txt`).

**Verified (2026-11-04):** 47 unit tests; `claude plugin validate`; type check. `scripts/e2e_long.py`: automatic compaction A/B, two runs per arm, contract on kept 3/3 open questions and recs (marker present), off kept 0/3; two-save scenario from `/`: project-root keyed, `previous` linked, three rules carried, conditional approval recorded, section targets, guard refused once then queued.

**Adaptive (2026-11-04):** items 1 (pending-list capture) and 2 (automatic save at the turn boundary) of `docs/01-adaptive-proposal.md` are built: 62 unit tests; e2e boundary run saved at 79% of a 117k point and compacted at 103k, before the engine; summary kept 3/3 questions verbatim. Items 3–5 not built.

**Activation (checked 2026-11-04):** fresh sessions on 2.1.310 (CLI) and 2.1.309 (desktop app) load 0.3.0 from this folder as `smart-compact@inline`, with both commands and the queue tool. Sessions opened before the 10:06 switch run the old version until reopened; the author's restarted session picked up 0.3.

**First real automatic save (2026-11-04 23:35Z, a Buildable session with a 1M window):** it started 4 s after a turn ended, at about 0.9M tokens, wrote a correct checkpoint (the carry-forward guard refused once; the save settled the item and queued), and absorbed no reply. **Bug, double compaction:** a `/smart-compact:save` the author typed during it ran as soon as it ended, found nothing new, reused the checkpoint and queued a second `/compact`. Both ran: 907,832 tokens to a summary (53 s), then 40,294 tokens to a summary of that summary (47 s). Cause: `compact_after_turn` (hooks/register.ts:170) queues even while an earlier `/compact` is queued and not yet run (`expecting` set), and the second run overwrites `expecting`.

**Next:** on the author's OK, fix the double compaction (the tool answers "already queued" while a compaction is pending or queued; regression test; an e2e scenario with a manual save typed during an automatic one), then watch one more automatic save. Later: decide whether to push to the public repo; then update the site (it describes 0.1) and redeploy with `cd site && vercel deploy --prod --yes` after deleting any `.env.local`.

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior; rehydrate tiers (core vs full) if the contract proves not enough.
