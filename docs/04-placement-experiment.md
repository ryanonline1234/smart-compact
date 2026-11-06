# 04 — Where the captured decision list goes: pre-registration

_Pre-registered 2026-11-05, before any run. Committed before the runs start; results are appended below this line set, never edited into it._

## Question

smart-compact captures the latest pending numbered decision list and puts it **inside the compaction instructions**, so the summarizer is told to keep it. Constraint Pinning (arXiv 2606.22528), CONPACT (arXiv 2608.11242) and the Claude API's `pause_after_compaction` instead **append** preserved text **after** the summary, where no summarizer can drop it. Which placement better lets the user answer "Go with recs" after the list has been compacted away from the conversation's verbatim tail?

## Arms

1. **off:** no summary contract and no capture (`summaryContract: false`): Claude Code's own compaction.
2. **instructions:** today's behavior: the contract plus the captured list in the compaction instructions (`pendingAskPlacement: instructions`).
3. **after:** the contract, and the captured list appended after the compaction instead, as SessionStart(`compact`) additional context (`pendingAskPlacement: after`).

## Scenario (`scripts/e2e_long.py --scenario placement`)

- Same as the earlier automatic-compaction A/B: two standing rules, then three numbered questions each with a recommendation, then large file reads.
- Window forced to 100k with `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
- The reads continue until **at least two** automatic compactions have happened. Claude Code keeps the most recent messages verbatim after a compaction, so one compaction can leave the list in that tail and test nothing.
- Then the user sends exactly: `Go with recs.`
- Model: `claude-sonnet-5-5`, as in the earlier A/B. 3 runs per arm, 9 sessions.

## Measures

- **Primary, resolved:** the reply to "Go with recs" names all three recommendations. Each counts when its first three content words appear in the reply. The reply must also not ask which recommendations are meant.
- **Secondary, verbatim:** how many of the three question lines appear verbatim in what the model sees after the last compaction: the summary, plus the appended context for **after**.
- **Validity checks:**
  - Each run has at least two compactions. A run without them is reported and excluded.
  - In **after**, the appended context is present in the transcript after the last compaction. If it never appears, the arm is invalid and is reported as such.
  - **off** fails to resolve in at least 2 of 3 runs. If it doesn't, the scenario does not stress the list and the experiment is uninformative.

## Decision rule

- **after** resolves in at least as many runs as **instructions**, and keeps at least as many lines verbatim: ship `both` (in the instructions *and* appended after) as the default, since the placements don't conflict and the appended copy cannot be summarized away.
- **instructions** resolves in more runs than **after**: keep `instructions` as the default.
- Both resolve in 0 or 1 of 3 runs: placement is not the problem at this n; report it and look at what is lost instead.

With 3 runs per arm, any difference is directional, not significant (two-sided Fisher on 3 against 0 runs gives p = 0.10). The result is reported that way.

## Known confounds

- The contract itself already asks the summarizer to keep open numbered questions verbatim. So **instructions** and **after** differ only in where the *captured copy* goes.
- The model sees the appended context as a system reminder attached at the session start after compaction, not as part of the summary. Whether it weighs that differently is part of what is measured.
- One scripted scenario, one model, one author's rubric.

## Results

_Run 2026-11-05, 9 sessions, `claude-sonnet-5-5`, CLI 2.1.310. Raw output: `~/smart-compact-runs/placement.json` and `~/smart-compact-runs/placement/`._

| Arm | Valid runs | Resolved "Go with recs" | Question lines verbatim after the last compaction |
|---|---|---|---|
| off | 3 of 3 | 1 of 3 | 0 of 9 |
| instructions | 3 of 3 | 0 of 3 | 9 of 9 |
| after | **0 of 3** | 1 of 3 | 9 of 9 (from the summary) |

**Verdict: inconclusive. The decision rule is not applied,** for two reasons fixed in advance or found in the instrument.

1. **The `after` arm is invalid** in all three runs, as the validity check defines it. Claude Code's `SessionStart:compact` event fired after each compaction (the transcript records it), but the appended copy never appeared. The event carries `source: 'compact'` as the mod reads it, so the failure lies elsewhere. Two possibilities remain: the mod's classic-hook result is not applied at a compaction's session start, or the capture was empty at that point. Not yet diagnosed.
2. **The primary measure failed as an instrument.** In the `instructions` arm, every reply showed the model knew the recommendations, for example "I applied your recs (project grouping with `inbox/`, dated kebab-case names, per-project `archive/`, root `INDEX.md`)". None restated them in their own words, though, because the sessions could only read files and the replies were about blocked writes. Counting a recommendation's words in the reply measures restating, not resolving.

**What the runs do show, from the secondary measure:** with the contract and capture, all question lines survived verbatim (9 of 9); without them, none did (0 of 9). Together with the earlier A/B, that is 6 runs per arm in the same direction. Even `off` named some recommendations in paraphrase (2, 3 and 1 of 3), because the summary kept their gist. That supports this experiment's validity check that `off` should mostly fail: it failed to resolve in 2 of 3 runs.

**Before a re-run:**
- diagnose the appended copy with a one-off mod that logs at `SessionStart:compact`;
- give the sessions write access in a scratch folder, so "Go with recs" can be acted on;
- grade resolution with a blind headless judge reading the reply and what the session did, not word overlap;
- use n = 5 per arm.

The arms, the scenario and the decision rule above stay as registered; only the instrument changes, and this section will say so.
