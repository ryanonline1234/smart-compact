# State

**Version:** 0.1.0, built 2026-11-03. Public since 2026-11-04: repo github.com/ryanonline1234/smart-compact, site smart-compact.vercel.app (Vercel project `smart-compact`, no Git link; redeploy with `cd site && vercel deploy --prod --yes`, after deleting any `.env.local` the CLI writes).

**Done:** plugin with `/smart-compact:save`, `/smart-compact:rehydrate`, and the hooks module (automatic compaction, measured rehydrate estimate, transcript-based re-attachment detection, save suggestion). 25 unit tests; `scripts/e2e.py` and `scripts/calibrate.py` reproduce the accuracy numbers; one-page site in `site/`.

**Next:** switch the author's local install from the pre-plugin copy (`~/.claude/skills/smart-compact` and `~/.claude/mods/smart-compact-auto`) to the marketplace plugin.

**Ideas, not started:** measure CJK; measure Fable 5.1's tokenizer; `claude plugin eval` graders for the skill's behavior; add a checkpoint pointer to engine-triggered compactions when a recent checkpoint exists.
