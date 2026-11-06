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
