# 05 — What compaction does to long sessions: one user's measurement

_Re-measured 2026-11-05 with `scripts/sessions_study.py` over the author's own Claude Code transcripts, 60-day window. The first measurement (2026-11-04) was made by two transcript-reading agents, whose method was not saved as code. This document gives a reproducible method, compares the two, and says which numbers hold up._

## Method

`scripts/sessions_study.py` reads `~/.claude/projects/*/*.jsonl` and reports aggregates only. Anyone can run it on their own transcripts.

- **Interactive sessions:** a transcript with a title row (`custom-title`, `ai-title` or `agent-name`), a working folder outside temporary directories, and at least three user messages. The `entrypoint` field can't be used: a `claude -p` run started from inside a desktop session inherits `claude-desktop`. Without this filter, the author's test harnesses and other projects' scripted probes made up most of the files, and the median automatic compaction fell to 72k tokens instead of 383k.
- **Compactions:** `compact_boundary` rows, de-duplicated by row uuid across resumed and forked transcripts, with the trigger (`auto` or `manual`), the size before, and whether the summary was precomputed.
- **What preceded a compaction:** tool calls and minutes since the user's last message. An automatic compaction with 0 tool calls within a minute of the user's message fired on that message.
- **Approvals:** user messages that start with an approval phrase (go with recs, continue, yes, go ahead, merge, ship it, and similar).
- **"Go with recs" answering a list:** the assistant's previous message holds a numbered list of at least two items with a `?` or a recommendation.
- **Loss candidates:** within the next five user messages after a compaction, one that points back ("as I said", "you forgot", "I already told you", "my earlier question", "we decided"). This is a keyword proxy that flags candidates; it confirms nothing.

## Results

| Measure | 2026-11-04, transcript-reading agents | 2026-11-05, `sessions_study.py` |
|---|---|---|
| Interactive sessions (60 days) | 229 | 232 |
| Compactions | 35 | 47 (30 manual, 17 automatic) |
| Automatic compactions | 17 | 17, of which 11 precomputed |
| Median size at an automatic compaction | 383k tokens | 383k tokens |
| Automatic compactions on the user's next message | 13 of 17 | 10 of 17 (0 tool calls, at most a minute) |
| Approvals among the user's messages | 42% | 24% (message starts with an approval) |
| "Go with recs" answering a numbered list | 73% | 78%, against 24% of other messages |
| Compactions followed by a loss | 7 of 35 (5 after automatic ones), judged by reading | 1 of 47 flagged by the keyword proxy |

## What holds up, and what doesn't

- **Holds up:** the population and the compaction profile. The session count, the automatic-compaction count and the median size all reproduce. So does the finding that "go with recs" answers a numbered list most of the time: 78% here, against 24% for other messages.
- **Depends on definitions:**
  - The approval share falls from 42% to 24% with a narrower definition: only messages that start with an approval, and no separate count of button clicks.
  - "On the next message" falls from 13 to 10 of 17 with a stricter one.
  
  Neither changes the design argument. Both are reported with the definition attached.
- **Does not reproduce mechanically:** the loss count. The agents read what happened after each compaction and judged 7 of 35 as losses, mostly standing rules and pending asks. A keyword proxy flags 1 of 47. The proxy is too narrow: a lost rule usually shows up as the user restating it, or as the model breaking it, not as a stock phrase. The 7-of-35 figure is cited as agent-judged until a rubric-based pass re-judges each compaction's aftermath and records its method: a clean headless judge per compaction, with the transcript before and after.

## Limits

- **One user, one machine, one working style.** It shows that the problem exists and how it looks; it doesn't show how common it is.
- **Aggregates only:** the script prints no message text unless `--examples` is passed, and then only to the local terminal.
- **Format dependence:** transcript fields can change between Claude Code releases. This run used 2.1.309–2.1.318.
