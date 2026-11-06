# 06 — The pending list held across compactions: pre-registration

_Pre-registered 2026-11-06, before any run. Committed before the runs start. Results are appended below this line set, never edited into it._

## Change under test

Through 0.5.1, the plugin captured the newest pending decision list only while it sat within the last six user messages. The correction to `docs/04` showed what follows: after the first compaction, nothing new was captured, and from then on the list survived only through the summary chain.

Branch `capture-persist` changes that:

- The newest ask is held in the session's store record.
- It is supplied at every main compaction. Once it has left the conversation, it is marked as carried and shown with the user's messages since.
- An answer ends the hold: an approval, a button's label, or a pick by number. The answer is supplied once, together with the list.
- A hold also ends after 7 days, after 20 messages without an answer, or when a newer ask replaces it.

## Question

Does the held list reach the summarizer at every compaction? And does anything regress against 0.5.1?

## Arms

1. **base:** `long-horizon` at 25bf5a2 (0.5.1), as an archived copy.
2. **persist:** `capture-persist` at the commit that adds this document.

## Scenario (`scripts/e2e_long.py --scenario persist`)

- **Setup:**
  - two standing rules;
  - then three numbered questions, each with a recommendation, in the form "N. <question>? Rec: <recommendation>.";
  - then user messages that each read two large notes files.
- **Compactions:** the window is forced to 100k with `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. The reads continue until at least three automatic compactions have happened, up to 24 files.
- **The answer:** the user sends exactly `Go with recs.`
- **Write access:** the session can act on the answer in its throwaway folder (`Read,Write,Edit,Glob`). `docs/04` found that a read-only session can't act on it.
- **Plugin settings:** `checkpointOnCompact` off and `suggestAt` -1, so only the contract and the capture are in play.
- **Runs:** `claude-sonnet-5-5`, 3 runs per arm. Both arms of a run run at the same time.
- **Instrument:** `SMART_COMPACT_TRACE` writes each compaction's final instructions to a folder. The base arm has no trace code, and by its code it supplies the list only at the first compaction.

## Measures

- **Primary (persist): delivery.** At every compaction before `Go with recs.`, the traced instructions contain all three question lines verbatim. From the second compaction on, they also carry the "captured before an earlier compaction" marker.
- **Secondary:**
  - (a) the question lines kept verbatim in each compaction's summary, both arms;
  - (b) both standing rules present in the last summary before the answer;
  - (c) resolution. A blind headless judge (Opus 5.5, `--safe-mode`, no tools) reads the three questions with their recommendations and everything the assistant did in reply to `Go with recs.`, without the arm. A run resolves when all three recommendations were acted on, the reply did not ask which were meant, and it did not apply a different list.
- **Validity:** each run has at least three compactions before the answer. In persist, each of them also has a trace file. A run that fails either check is reported and excluded.

## Decision rule

- **Pass:** persist delivers at every compaction in 3 of 3 valid runs, with no regression:
  - its verbatim count in the last summary before the answer is at least base's minus 1 (of 9);
  - its resolutions are at least base's minus 1 (of 3).

  Then propose the merge into `long-horizon` to the main session, and `scripts/install-live.sh` to Ryan. Neither happens without their word.
- **Delivery fails in any valid run:** no merge. Diagnose from the trace.
- **A regression past the tolerance:** no merge. Report it.

## Known limits

- **The arms aren't expected to separate on outcomes.** In `docs/04`, the contract chain already kept the list verbatim 9 of 9 in this kind of scripted scenario. This gate checks delivery and no regression, not an outcome gain. The fix is defensive: it removes the dependence on the summary chain that failed in real sessions (the confirmed judge miss in `docs/05`).
- **Not tested end to end:**
  - the fork receiving the held list (unit test only, with `checkpointOnCompact` off here);
  - restart persistence (unit test only).
- **Scope:** n = 3 per arm, one scenario, one model. The author's settings hooks run in every session.

## Results

_Run 2026-11-06. 6 sessions on `claude-sonnet-5-5`, CLI 2.1.310; the judge was Opus 5.5. Raw output: `~/smart-compact-runs/persist/` (`persist-20261105T174438.json`, the session logs, and one trace folder per run)._

| Arm | Valid runs | Delivered at every compaction | Carried marker on #2 and #3 | Lines verbatim in the last summary | Rules in the last summary | Resolved "Go with recs." |
|---|---|---|---|---|---|---|
| base (0.5.1) | 3 of 3 | not traced; by its code, #1 only | — | 9 of 9 | 3 of 3 | 3 of 3 |
| persist | 3 of 3 | **3 of 3** (3, 3, 3 lines at each of 3 compactions) | 3 of 3 (absent on #1, as registered) | 9 of 9 | 3 of 3 | 3 of 3 |

**Verdict: pass, by the registered rule.** Persist delivered the list at every compaction in 3 of 3 valid runs. It did not regress on any secondary measure: 9 against 9 lines verbatim, 3 against 3 on rules, 3 against 3 resolved.

- **What the runs show:** from the second compaction on, the summarizer is now handed the held list verbatim, marked as carried. With it come the user's messages since, without the kept-verbatim tail counted twice (trace of run 1, compaction #2).
- **What they don't show:** an outcome gain. As registered, the summary chain alone kept the list in this scenario (base 9 of 9), and every session in both arms resolved the answer. The judge's reasons agree: in all six runs, all three recommendations were acted on, none asked which list was meant, and none applied a different one.
- **Incidental:** base run 3 compacted four more times while answering, as it reorganised the notes. That is not a measure here.
- **Instrument note:** the sessions ran with the author's settings and global instructions. One judge reason calls the user "Ryan". This confound is shared by both arms, as registered.

**Correction to the known limits above.** They cite the confirmed judge miss in `docs/05` as a failure of the summary chain. Re-reading that session shows the summary kept the user's redirect verbatim. That was a request kept but not acted on, and it came before the decision list, not in reply to it. So no observed real-session loss of a pending list motivates this change. It rests on the mechanism `docs/04` found: capture did not persist past the first compaction. The fix is defensive.

**After the gate (2026-11-06):** the main session found that a prompt beginning with a `<system-reminder>` block failed the reply filter. In the desktop app, 7 of 38 of Ryan's prompts did. So a "Go with recs." sent that way wouldn't have ended a hold or been recorded as the answer. The fix strips leading system-reminder blocks before testing a message. It has a unit test only: the e2e prompts carry no such block, so this gate didn't exercise it.

**Review fixes (2026-11-06, main session's review):**
- **The 20-message cap applies to a list still in the conversation, too.** Before, such a list was supplied once more before it expired.
- **A pick by number needs a pick verb, `#` or `option`, two or more numbers, or a number alone.** A message that merely opens with a number ("20 minutes later it failed") no longer ends a hold.

Both have unit tests only.
