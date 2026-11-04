# State

**Version:** 0.2.0 ("long-horizon"), built 2026-11-04 on local branch `long-horizon`, **uncommitted, not pushed**. Public `main` (github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app) is still 0.1.0.

**Installed for the author:** loaded from this working copy via `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (backup: `settings.json.pre-smart-compact-0.2.bak`), options under `pluginConfigs["smart-compact@inline"]` (`suggestAt: 400000`). Profile: `~/.claude/smart-compact/profile.md`. The pre-plugin skill and mod are in `~/Archive/` (logged in `~/Archive/CLEANUP-LOG-2026-10-11.txt`).

**Verified (2026-11-04):** 47 unit tests; `claude plugin validate`; type check. `scripts/e2e_long.py`: automatic compaction A/B, two runs per arm, contract on kept 3/3 open questions and recs (marker present), off kept 0/3; two-save scenario from `/`: project-root keyed, `previous` linked, three rules carried, conditional approval recorded, section targets, guard refused once then queued.

**Next:** decide whether to commit and push 0.2 to the public repo; then update the site (it describes 0.1) and redeploy with `cd site && vercel deploy --prod --yes` after deleting any `.env.local`.

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior; rehydrate tiers (core vs full) if the contract proves not enough.
