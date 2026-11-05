# 01 — Adaptive smart-compact

_Status, 2026-11-04: item 1 BUILT on the `long-horizon` branch. Item 2 was built in 0.3 and RETIRED in 0.3.2 (see DECISIONS.md); `02-autocompact-checkpoints.md` replaces it. Items 3–5 are proposals._

## What the sessions show

Measured over the author's transcripts: 58 compactions, 17 of them started by Claude Code itself.

| Situation at compaction | Count | Automatic | Signal the plugin can see |
|---|---|---|---|
| Right after a commit, merge or deploy | 20 | 9 | Bash calls with `git commit/merge/push`, `vercel --prod`; a write to `HANDOFF/NN` |
| Long autonomous run (40+ tool calls since the user spoke) | 9 | 2 | tool calls counted since the last `prompt.submit` |
| Edit-heavy build | 3 | 1 | Edit/Write share of recent tool calls |
| Reading or research | 1 | 0 | Read/Grep/fetch share |
| Mixed or unclear | 25 | 5 | — |

- **Automatic compactions mostly fire on the user's next message.** 13 of 17 had zero tool calls and zero minutes since the user's message. The previous turn ended just under the threshold; the reply pushed it over. Only 2 fired mid-run (71 and 101 calls).
- **Approvals follow compactions.** 18 of 58 first messages after a compaction were approvals, and 73% of "go with recs" answer a numbered list. The list has to survive.

## What should adapt

1. **Capture the pending list mechanically.** At any compaction, the plugin reads the last assistant message. If it ends with numbered questions or recommendations, the plugin quotes those lines verbatim into the compaction instructions (capped). This needs no save and no summarizer judgment. Signal: lines matching a numbered item with `?` or `Rec`.
2. **Save at the turn boundary before the overflow.** At the end of a turn, when context is at or above 85% of the session's auto-compaction point, the next message will almost certainly trigger a compaction. The plugin can queue `/smart-compact:save` right then, while the user is reading, so the reply lands on a checkpointed session. The same applies at 50% or more when an iteration boundary just happened (a commit, merge, deploy or new handoff), because a boundary is the cheapest place to compact. Option `autoSave`: `off` | `suggest` (default) | `boundary`.
3. **Match checkpoint depth to the situation.** The plugin tells the save step what it saw, through the prompt's `context`: for example "iteration boundary: merge 2 calls ago, HANDOFF/84 written". At a boundary the durable state is already on disk, so the checkpoint is light. Its manifest is `STATE.md#Next action`, the newest handoff and the open decisions, under a small budget. Mid-build, it records the active edit sites and the diff, under the full budget.
4. **Recommend a rehydrate depth.** The post-compaction notice says "light is enough" at a boundary and "full recommended" mid-build, with both estimates.
5. **Checkpoint inline during long autonomous runs.** When a long run nears the threshold, a one-time note rides on the next tool result: "write a checkpoint now, without compacting; then continue". The engine's own compaction then carries its pointer. Deferred: 2 of 17 cases, and the 0.2 contract already covers those.

## Costs and risks

- An automatic save is a model turn the user did not ask for: tokens, plus file writes (the checkpoint, and the STATE/DECISIONS flush). It is opt-in, and its flush can be limited to the checkpoint.
- Mechanical list capture can misfire on numbered steps that are not questions. Requiring `?` or `Rec` on the line limits that. A false positive costs a few hundred characters in a summary.
- The situation classifier is coarse: 25 of 58 compactions classified as mixed. Adaptations 3 and 4 should fall back to today's behavior when the signal is weak.

## Verification plan

- Unit tests: list extraction on real assistant messages (positive and negative), the boundary detector, the `autoSave` trigger math.
- E2E: extend `scripts/e2e_long.py`. One scenario ends a turn at 90% of a forced 100k auto point, and checks that the next message lands after a save. Another has a pending list but no save, and checks the summary keeps it verbatim with list capture on and off.
