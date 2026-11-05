# 03 — Novelty assessment (survey of 2026-11-05)

_Prior-art survey across Claude Code, its mod and plugin ecosystem, 14 other coding agents, agent-memory frameworks and 2026 papers. "Appears new" means not found in this survey. Produced with research subagents; the author's own measurements are marked as such._

## Enforcement, not plumbing, sets smart-compact apart

Every one of smart-compact's seven mechanisms rests on prior art. Two appear new outright, and the other five pair established mechanics with a new final step. A survey run on 2026-11-05 covered Claude Code, its mod and plugin ecosystem, 14 other coding agents, agent-memory frameworks and the 2026 compaction literature. None of them does mechanism (3), a guard that refuses a new checkpoint because it silently drops a standing rule or open decision the previous checkpoint held. None does mechanism (4) either: mechanically capturing the latest pending numbered decision list into the compaction instructions. The plumbing is not new. Injecting instructions into automatic compactions (1), checkpointing to disk before compaction (2), and forking a same-model, tools-denied copy of the conversation at compaction (5) all ship in October 2026 Claude Code mods. Those mods are built on Anthropic's own `session.compact` and `$.model.fork` primitives, and Codex, Roo, Kilo and the Claude API offer equivalents. What the other tools lack is enforcement. No contract surveyed names open numbered decisions with their recommendations, or approvals with their conditions. No fork-written checkpoint is checked and corrected before use. No rehydration skips what Claude Code itself re-attached (6). The token ratios (7) re-measure a tokenizer Anthropic has documented since April 2026. Their real contribution is a per-file spread on Claude 5.5 Read-tool output, plus the finding that Claude Code's own 3-bytes-per-token estimate runs 10 to 20% low. The 1.3 to 1.5x gap against folk rules matters less. The author's own evidence points the right way and matches published research on constraint decay, but it is not yet a result. The honest pitch is "enforcement layered on Claude Code's compaction". It should carry the survey date and say "not found in", never "first".

### Two mechanisms appear new; five pair old plumbing with a new step

| # | Mechanism | Closest prior art | What smart-compact adds | Verdict | Confidence |
|---|---|---|---|---|---|
| 1 | Summary contract in every compaction, automatic ones included | bindwright compact-handoff, handoff-compact, workface, idle-compact; Codex `compact_prompt`; Claude API `instructions` | Open numbered decisions with recommendations kept verbatim; approvals with their conditions | Partly new | High that injection exists; medium that the categories are unclaimed |
| 2 | Checkpoint on disk before compaction, with rehydration manifest and measured token estimate | compact-plus, Token Optimizer; bindwright "Read next" paths and line ranges; MemGPT memory pressure | Section-level targets; a measured estimate instead of chars/4 | Partly new, mostly existing | High / medium |
| 3 | Carry-forward guard refusing silent drops against the previous checkpoint | Gemini CLI "Safeguard" merge; Constraint Pinning; compacli-harness (design only) | Refusal of a checkpoint that drops a rule or open decision without an explicit resolution | Appears new | Medium |
| 4 | Mechanical capture of the latest pending numbered decision list into instructions | handoff-compact verbatim tail; CONPACT extractor; `pause_after_compaction` | Targets the assistant's open list, and places it inside the summarizer's instructions | Appears new | Medium |
| 5 | Fork at engine compactions writing a checkpoint beside the summary, then checked and corrected | bindwright shadow mode; handoff-compact; Anthropic background compaction; Slipstream | Validation and correction of the fork's checkpoint while the stock summary stays | Partly new | High that the fork exists; medium that the check is unclaimed |
| 6 | Budgeted, opt-in rehydration skipping files Claude Code re-attached | context-mode `ctx_resume`; MemGPT paging; unforget's dedupe against the summary | Dedupe against Claude Code's own re-attached files | Partly new (small) | Medium |
| 7 | Chars per token on Claude 5: 2.73 prose, 2.49 code, within 12% per file | Anthropic docs (about 2.69 implied); ClaudeCodeCamp and cometkim on Opus 4.7; Claude Code's own 3 bytes/token | Measurement on the 5.5 generation, on Read-tool output, with a per-file spread | Partly new | High |

In this report, "appears new" means "not found in the sources surveyed". It is not proof of absence. The survey covered:

- Claude Code's docs, changelog and published mod type declarations.
- GitHub API reads of Claude Code plugins and mods.
- A keyword filter over the aidojo mods catalogue. Its `mods.json` held 8,532 entries when generated on 2026-11-01, while its homepage says 7,351 ([mods catalogue](https://mods.aidojo.si/mods.json)).
- Main-branch source and docs for 14 other coding agents.
- Docs from Anthropic, OpenAI, LangChain, LlamaIndex, Letta and Mem0.
- Papers from 2023 to 2026, several read only through abstracts.

The survey has known gaps:

- Two catalogue entries whose repositories returned 404 were judged on their descriptions alone.
- bindwright, handoff-compact and workface were searched for checking logic rather than read end to end.
- Cursor's and Amp's summarizers are closed source.

The comparison set is also very young. Mods became default-on on **2026-10-01** ([Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)), and most of the close analogues are repositories or mods from early October 2026 with fewer than 15 stars. The famous memory tools are the wrong yardstick. claude-mem (★113,461), for example, solves cross-session memory and does not touch the compaction prompt ([claude-mem](https://github.com/thedotmack/claude-mem)).

### Claude Code ships the hooks, not the retention policy

Three layers decide what a Claude Code compaction keeps, and only the newest one can steer an automatic compaction.

**The `/compact` command.** Typing `/compact [instructions]` adds focus instructions to the built-in compaction prompt; it does not replace it ([Commands](https://code.claude.com/docs/en/commands); [mod types](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)). The summary comes from a separate request. That request repeats the session's system prompt, tools and history, and reads that prefix from the prompt cache while the cache is warm ([Prompt caching](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation)).

**Automatic compactions.** Settings hooks receive **`custom_instructions: null`** for these ([Hooks reference](https://code.claude.com/docs/en/hooks#precompact)). No setting or environment variable replaces the prompt; they only toggle compaction or move its threshold ([Settings reference](https://code.claude.com/docs/en/settings-reference#autocompactenabled); [Environment variables](https://code.claude.com/docs/en/env-vars)).

**The CLAUDE.md route.** The docs suggest a "Compact Instructions" section in CLAUDE.md ([Manage costs](https://code.claude.com/docs/en/costs)). One third-party measurement on CLI 2.1.186 found **0 of 447** compactions honouring it, and the same README elsewhere gives 0 of 354 ([compact-canon](https://github.com/tonydzi/compact-canon)). With a single author, an older build and figures that disagree with each other, treat this as open.

Anthropic does tune the built-in prompt. Version 2.1.139 (2026-05-11) asks it to preserve sensitive user instructions, and 2.1.311 (2026-10-26) asks once more when a reply contains no summary ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)). Anthropic's own description of the prompt's priorities is technical: architectural decisions, unresolved bugs and implementation details. User working rules are not on that list ([Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

Settings hooks can watch compaction but cannot shape it:

- PreCompact can only observe or block.
- PostCompact receives the finished `compact_summary` but has no decision control.
- A SessionStart hook matching `compact` is the documented way to append context afterwards ([Hooks reference](https://code.claude.com/docs/en/hooks#postcompact); [Hooks guide](https://code.claude.com/docs/en/hooks-guide#re-inject-context-after-compaction)).

Third parties disagree about whether PreCompact's standard output reaches the summarizer, and the docs are silent on it. Anthropic has declined the features closest to smart-compact's guard. Issue #43733 asked for PreCompact to let Claude write session state, and #40492 asked for a post-compaction verification gate. Both were **closed as not planned** in spring 2026. A request for custom auto-compact instructions (#14160) was closed as a duplicate ([#43733](https://github.com/anthropics/claude-code/issues/43733); [#40492](https://github.com/anthropics/claude-code/issues/40492); [#14160](https://github.com/anthropics/claude-code/issues/14160)).

Mods, default-on since **v2.1.287**, removed that ceiling. The prose reference lists only `{ skip }` as a `session.compact` return ([Mods reference](https://code.claude.com/docs/en/plugins/mods/reference#session)). The published type declarations allow much more:

- A hook can rewrite `instructions` on every trigger: `manual`, `auto`, `plugin` and `precompute`.
- A hook can rewrite the messages being summarized, or return its own `{ messages }`.
- `$.session.compact({ instructions })` starts a compaction from a mod ([claude-code.d.ts](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)).

Note that `precompute` dispatches, and idle compaction (which fires under the `auto` matcher), count toward any claim of "every compaction".

`$.model.fork({ prompt })` sends the current conversation plus a prompt, using the session's model and system prompt. Claude's tools are present but cannot be called, and most of the request is served from the prompt cache ([Mods API](https://code.claude.com/docs/en/plugins/mods/api#call-a-model)). The call returns `null` on a cold snapshot or an API error. That is the "same model, same cached transcript, tools denied" fork of mechanism (5), and Anthropic supplies it.

The mod surface is still fragile:

- Open issues report `{ messages }` replacements being undone or garbled on `--resume` ([#95328](https://github.com/anthropics/claude-code/issues/95328); [#107178](https://github.com/anthropics/claude-code/issues/107178)).
- The Desktop app renders kept messages twice ([#96502](https://github.com/anthropics/claude-code/issues/96502)).
- Replacement breaks tool-use pairing ([#101096](https://github.com/anthropics/claude-code/issues/101096)).
- `$.session.compact()` is refused in Desktop and headless sessions ([#102278](https://github.com/anthropics/claude-code/issues/102278); [#105472](https://github.com/anthropics/claude-code/issues/105472)).

After a compaction, Claude Code brings back the following ([Context window](https://code.claude.com/docs/en/context-window#what-survives-compaction)):

- Re-read from disk: the **project-root CLAUDE.md, unscoped rules, auto memory (first 200 lines or 25KB) and the plan-mode plan**.
- Rebuilt: skill descriptions (v2.1.304+) and git status.
- Re-read files: **up to five** files Claude read or edited, most recently modified first. Any file over **5,000 tokens** comes back as a bare path.
- Restored with caps: invoked skill bodies, at 5,000 tokens each and 25,000 in total.
- Added: SessionStart(compact) hook output.

Some things are summarized away instead: instructions given only in conversation, path-scoped rules and nested CLAUDE.md files until they are triggered again, and context that hooks added earlier. The docs' remedy is to move the instruction into CLAUDE.md ([Memory](https://code.claude.com/docs/en/memory)). To-do lists no longer fill the gap on new models. From 2.1.233, TodoWrite is off for Opus 4.8, Sonnet 5 and newer unless an environment variable turns it back on ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).

Idle compaction now summarizes conversations of 200K+ tokens left idle for about an hour. It has run in the terminal since 2.1.299 (2026-10-14), and in VS Code and Desktop since 2.1.314 (2026-10-30) ([Settings reference](https://code.claude.com/docs/en/settings-reference#idlecompaction)). Rewind can summarize from or up to a chosen point, with optional guidance ([Checkpointing](https://code.claude.com/docs/en/checkpointing)). Resume reloads the last summary, not the original messages ([Sessions](https://code.claude.com/docs/en/sessions)). No native feature writes a rehydration checkpoint or restores what a summary dropped.

That map splits smart-compact's targets in two:

- **Standing rules have a native workaround.** A user who writes a rule into CLAUDE.md or auto memory gets it back from disk after every compaction. smart-compact's value here is catching rules that were only ever stated in chat.
- **Pending numbered decisions and approvals with conditions have none.** Nothing native brings them back, because they live only in assistant and user turns that the summary may or may not keep. This category has no native competitor.

### Contracts, checkpoints and compaction forks already ship in October mods

#### (1) The injection exists; the decision and approval categories do not

Injecting a contract into every compaction, automatic ones included, is now routine. At least five Claude Code mods do it through `session.compact`:

- ukwhatn's idle-compact joins a configured "Compact Instructions" section into `e.instructions` on all four triggers ([register.ts](https://github.com/ukwhatn/.claude/blob/HEAD/skills/idle-compact/hooks/register.ts)).
- workface briefs the summarizer on every compaction, auto or manual ([workface](https://github.com/scodge-24/workface)).
- compact-shaper adds a fixed hand-off block ([register.ts](https://github.com/MichaelP17/claude-mods/blob/HEAD/compact-shaper/hooks/register.ts)).
- bindwright's compact-handoff replaces the summarizer instructions with a hand-off prompt ([bindwright register.ts](https://github.com/starfoxcom/bindwright/blob/HEAD/_core/global-template/mods/compact-handoff/hooks/register.ts)).
- trytofly94's handoff-compact replaces the summary itself, and was tested across six automatic compactions in one long turn ([handoff-compact](https://github.com/trytofly94/handoff-compact)).

Outside Claude Code:

- Codex reads a user `compact_prompt` in its automatic path ([compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)).
- Roo applies a custom condensing prompt to both triggers ([condense/index.ts](https://github.com/RooCodeInc/Roo-Code/blob/main/src/core/condense/index.ts)).
- Kilo exposes a plugin hook to inject context or replace the compaction prompt ([compaction.ts](https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/session/compaction.ts)).
- The Claude API's `instructions` field, up to **16,384 characters**, replaces the default summarization prompt ([Compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)).

The contract's content is closer to new. The nearest sections in other tools are:

- bindwright's "Owed to the person" section (open questions, promises, anything waiting on the person's answer), backed by carrying the person's own messages verbatim ([bindwright register.ts](https://github.com/starfoxcom/bindwright/blob/HEAD/_core/global-template/mods/compact-handoff/hooks/register.ts)).
- handoff-compact's "BLOCKED / OPEN QUESTIONS" section, which includes what the agent meant to ask the user ([handoff-compact](https://github.com/trytofly94/handoff-compact)).
- The default prompt of the Anthropic SDK's client-side compaction (since dropped from the Python SDK v1.0). It kept clarifications or constraints, blockers or open questions, and promises made to the user ([Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).

Several tools cover the standing-rules half of the contract:

- Gemini CLI's `<active_constraints>` section and its approved-plan block ([snippets.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/prompts/snippets.ts)).
- OpenHands' `TASK_TRACKING` section, which keeps exact task IDs ([summarizing_system.j2](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/context/condenser/prompts/summarizing_system.j2)).
- Standing-rule re-injectors such as joeldg's standing-orders ([standing-orders](https://github.com/joeldg/claude-mods/tree/HEAD/standing-orders)) and Sting25's signed standing rules ([claude-code-handoff](https://github.com/Sting25/claude-code-handoff)).

None of them asks for open numbered decisions with their recommendations kept verbatim, or for approvals together with the conditions attached to them.

One attribution caveat: ryanportfolio/winuse-mcp contains a skill also named smart-compact, in a single commit dated 2026-10-24. Its fork writes `/compact` instructions that keep "standing instructions or preferences" and "pending questions to the user", but only when run by manual command ([register.ts](https://github.com/ryanportfolio/winuse-mcp/blob/HEAD/.claude/skills/smart-compact/hooks/register.ts)). If that repository is not the author's, it is the closest content-level match.

Research also limits how much a prompt contract can do on its own. On ProgramBench, constraints were dropped even when the summarization prompt explicitly asked to keep persistent user requests ([arXiv 2610.31778](https://arxiv.org/html/2610.31778)). ConstraintRot found that cutting the summary budget from 300 to 15 words dropped constraint survival from **88% to 23%** ([arXiv 2606.22528](https://arxiv.org/html/2606.22528v2)). The contract is only as strong as mechanisms (3) and (4), which check and feed it.

**Verdict: partly new.** The injection exists (high confidence). The decision-with-recommendation and approval-with-conditions categories appear new (medium confidence, because only keyword-matched catalogue entries were reviewed).

#### (2) Checkpoint-before-compaction is commodity; measured section targets are not

Writing state to disk before compaction is the most common pattern in the ecosystem:

- compact-plus (★207) backs up the transcript and writes a 10-section state file from a PreCompact hook, on both manual and automatic compactions ([compact-plus](https://github.com/u-ichi/compact-plus)).
- Token Optimizer (★2,891) checkpoints before auto-compaction and restores afterwards ([token-optimizer](https://github.com/alexgreensh/token-optimizer)).

The idea predates Claude Code:

- In 2023, MemGPT inserted a "memory pressure" warning at about 70% of the window, so the model could save to durable storage before eviction ([MemGPT](https://arxiv.org/html/2310.08560)).
- The Claude API's context editing warns Claude to save to the memory tool before results are cleared ([Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
- Kiro's IDE 1.0 persists its compaction summary as a session checkpoint ([Kiro IDE 1.0](https://kiro.dev/docs/ide/whats-new-v1/compaction/)).
- Cline carries read and modified file lists from one summary to the next ([compaction-shared.ts](https://github.com/cline/cline/blob/main/sdk/packages/core/src/extensions/context/compaction-shared.ts)).

The manifest has one close match. bindwright's hand-off prompt asks for:

- a "Read next" list of exact file paths and line ranges to open first, each with its reason;
- a "Don't re-read" list.

It records each hand-off to Markdown and budgets it at 2.5% of the compaction window, clamped to 2,000–15,000 tokens and **estimated at 4 characters per token** ([bindwright register.ts](https://github.com/starfoxcom/bindwright/blob/HEAD/_core/global-template/mods/compact-handoff/hooks/register.ts)). context-mode caps its post-compaction state block at 2,048 bytes ([context-mode](https://github.com/mksglu/context-mode)).

smart-compact differs in two details. Its targets include document sections, not just files and line ranges. Its token estimate is calibrated against measured ratios rather than a chars/4 rule.

**Verdict: partly new, mostly existing.** Checkpointing before compaction is commodity (high confidence). Section-level targets with a measured estimate appear new but are an incremental refinement (medium confidence: bindwright's commit history was not retrieved, so it is unknown when its manifest section appeared).

#### (5) Forks at engine compactions exist; checking and correcting their output does not

At least three mods already fork the conversation at a compaction the plugin did not start:

- **bindwright's shadow mode** is the closest structural twin. It runs `Promise.all([ next(e), $.model.fork({ prompt: handoffPrompt(budget) }) ])`: the stock compaction proceeds while a fork writes a hand-off beside it for comparison. Both are recorded to disk, and the fork's output is labelled "Hand-off (shadow, not used)" ([bindwright register.ts](https://github.com/starfoxcom/bindwright/blob/HEAD/_core/global-template/mods/compact-handoff/hooks/register.ts)).
- **handoff-compact**'s fork writes a nine-section hand-off that replaces the summary and is saved as Markdown. If the fork fails, it falls back to plain instructions ([handoff-compact](https://github.com/trytofly94/handoff-compact)).
- **kzarzycki's compact-methods** can run a fork-based method when context fills ([register.ts](https://github.com/kzarzycki/claude-mods/blob/HEAD/plugins/compact-methods/hooks/register.ts)).
- **ray-amjad's memory-fork** (★107) replays the transcript with every tool denied, for a different purpose ([memory-fork](https://github.com/ray-amjad/claude-code-mods/tree/HEAD/plugins/memory-fork)).

Outside the mod ecosystem:

- Anthropic's background compaction runs a summary request over a snapshot, with the same `system` and `tools` and no tool calls, while the conversation continues ([Compaction in the background](https://platform.claude.com/docs/en/build-with-claude/compaction-background)).
- The Slipstream paper runs the compactor asynchronously and has a judge check its summary against the agent's next reasoning steps. It reports up to **+8.8 accuracy points and 39.7% lower latency** on SWE-bench Verified and BrowseComp ([arXiv 2605.08580](https://arxiv.org/abs/2605.08580)).
- Gemini CLI's `StateSnapshotAsync` maintains structured state in the background, but with a separately configured model ([profiles.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/context/config/profiles.ts)).

What smart-compact adds is the final step. The fork's checkpoint is checked against standing rules and the previous checkpoint and corrected, just as a manual save would be, while the stock summary stays in place. By contrast:

- bindwright's shadow output is never checked or used.
- handoff-compact's output replaces the summary unchecked.
- Slipstream validates against the agent's future steps, not its prior state.

Keeping the stock summary also avoids the `{ messages }` replacement bugs listed above, which gives it an engineering advantage over handoff-compact's design. This is an inference from the issue reports, not a tested comparison. The fork's cache savings depend on keeping tool definitions in the prompt prefix, because changing them invalidates the entire cache ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). `$.model.fork` keeps them by design.

The author reports that fork-written checkpoints on 0.5.1 matched or beat manual saves on all rubric lines in 5 of 5 A/B pairs, and that a blind judge scored them 106 against 100 of 125. That is the author's own evidence and is discussed in the claims section below.

**Verdict: partly new.** A fork writing beside the summary at engine compactions exists (high confidence). Validating and correcting the fork's checkpoint appears new (medium confidence: the competing mods were searched for checking logic, not read in full).

### No surveyed tool refuses a lossy checkpoint or captures pending decisions

#### (3) The carry-forward guard has near designs but no shipped twin

Nothing surveyed compares a new snapshot against the previous one and refuses it for a silent drop.

**Gemini CLI** has the nearest shipped design, in its new snapshot generator. The merge code, commented "Merging Application Logic (The Safeguard)", copies the previous state and deletes constraints only by explicit index. If generation fails, it falls back to the previous state ([snapshotGenerator.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/context/utils/snapshotGenerator.ts)). That is carry-forward by construction, not refusal. It accepts any deletion the model proposes, and when the state is over its 4,000-token budget, its backstop silently drops the oldest constraints. Gemini also has:

- an LLM "Probe" pass that asks whether user constraints were omitted ([chatCompressionService.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/context/chatCompressionService.ts));
- an offline eval that checks whether the directive "do not fix it just yet" survives ([snapshot_fidelity.eval.ts](https://github.com/google-gemini/gemini-cli/blob/main/evals/snapshot_fidelity.eval.ts)).

**In research**, Constraint Pinning keeps governance constraints in a buffer that compaction cannot touch. It re-injects them verbatim and checks at every step that the post-compaction context still entails them. This cut violations to **0% for about 47 pinned tokens** ([arXiv 2606.22528](https://arxiv.org/html/2606.22528v2)). compacli-harness pre-registers an "extract → verify → repair loop" around Claude Code compaction with "a typed ledger with supersession", but publishes no results ([compacli-harness](https://github.com/rajesamp/compacli-harness)).

**In the mod ecosystem**, none of the near matches refuses anything:

- unforget diffs dropped messages against the built-in summary ([unforget](https://github.com/rupaut98/unforget)).
- handoff-compact carries the previous hand-off's verbatim tail forward ([register.js](https://github.com/trytofly94/handoff-compact/blob/HEAD/hooks/register.js)).
- bindwright asks the model to list every decision, promise and open question silently, then confirm each one is kept ([bindwright register.ts](https://github.com/starfoxcom/bindwright/blob/HEAD/_core/global-template/mods/compact-handoff/hooks/register.ts)).

Mem0 goes the other way: it lets the model DELETE memories that new information contradicts ([Mem0](https://arxiv.org/html/2504.19413)).

The guard targets a measured failure. On ProgramBench, the average number of anti-cheating rule categories dropped (out of three) rises from **0.92 at the first compaction to 2.65 by the 30th**, because each summary is written from the last one ([arXiv 2610.31778](https://arxiv.org/html/2610.31778)). ACE documented a single rewrite collapsing 18,282 tokens of context to 122 ([ACE](https://arxiv.org/html/2510.04618)). Diffing checkpoint N+1 against checkpoint N directly counters that compounding.

The novelty claim needs one precision. If the check is a deterministic diff of rule and decision entries, it is distinct from Gemini's Probe and bindwright's self-check, which are the model judging itself. If the model decides what counts as a drop, it sits much closer to them.

**Verdict: appears new.** Medium confidence. The idea is in the air: compacli-harness names the loop and Constraint Pinning checks entailment. A write-up should cite both.

#### (4) Verbatim tails keep the user's words, not the assistant's open list

Mechanical verbatim capture exists, but it is aimed at the user's words rather than the assistant's pending list:

- handoff-compact keeps the last 10 user prompts, clipped to 1,000 characters, and the last answers, clipped to 600. That would cut a long numbered list ([register.js](https://github.com/trytofly94/handoff-compact/blob/HEAD/hooks/register.js)).
- bindwright carries only the person's messages.
- Codex keeps prior user messages verbatim up to **20,000 tokens** ([compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)).
- Roo's default prompt asks the model to quote recent conversation verbatim for the next step. That is the model's choice, not a capture ([support-prompt.ts](https://github.com/RooCodeInc/Roo-Code/blob/main/src/shared/support-prompt.ts)).

Other tools append text after the summary:

- The Claude API's `pause_after_compaction` lets a client insert blocks after the summary, such as specific instruction messages ([Threshold compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)).
- CONPACT appends separately extracted constraints after compaction, raising retention from **17% to over 90%** ([arXiv 2608.11242](https://arxiv.org/abs/2608.11242)).

Mods do detect numbered options, but only to render buttons, with no link to compaction. reply-choices turns trailing numbered options into buttons, and quick-reply offers a "Go with your recommendation" button ([mods catalogue](https://mods.aidojo.si/mods.json)).

smart-compact's capture is new in both target and placement. The latest pending numbered decision list is written by the assistant, so tails that keep user messages miss it. And smart-compact routes the list into the summarizer's instructions, whereas Constraint Pinning, CONPACT and `pause_after_compaction` append text after the summary, so it never passes through the summarizer. Pinning's 0% violation result suggests appending is at least as safe. Which placement keeps recommendations better is untested, and the author's A/B measured only the instruction route. No published study was found that measures retention of open decisions or pending question lists across compaction; the literature measures constraints and preferences.

**Verdict: appears new.** Medium confidence, because only keyword-matched catalogue entries were reviewed.

#### (6) Opt-in, budgeted reload is generic; deduping against native re-attachment is small but unclaimed

Budgeted, on-demand reload is a generic pattern:

- MemGPT pages evicted content back in by function call ([MemGPT](https://arxiv.org/html/2310.08560)).
- LlamaIndex re-inserts priority-ranked memory blocks under a `token_limit` ([LlamaIndex Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)).
- context-mode, the closest opt-in design in Claude Code, sends a 2,048-byte state block automatically and the rest only when the agent calls `ctx_resume` ([context-mode](https://github.com/mksglu/context-mode)).
- Most compaction tools inject automatically at SessionStart(compact) instead ([compact-plus](https://github.com/u-ichi/compact-plus)).
- Roo re-injects folded file signatures after every condense, up to 50,000 characters ([foldedFileContext.ts](https://github.com/RooCodeInc/Roo-Code/blob/main/src/core/condense/foldedFileContext.ts)).

Deduplication exists in three forms: against the built-in summary (unforget drops what the summary already carries), against the tool's own notes (workface), and as a model-written "Don't re-read" list (bindwright). None was found against the files Claude Code itself re-attached. That step matters, because the native reload fills up to five file slots before any plugin acts. It also carries a fragility. The docs describe selection only as "most recently modified first" ([Context window](https://code.claude.com/docs/en/context-window#what-survives-compaction)), so the dedupe must read what was actually re-attached rather than predict it.

**Verdict: partly new.** The dedupe appears new but is a small step. Medium confidence.

### The token ratios re-measure a tokenizer documented since April

The ratios confirm a known tokenizer shift, measured on a new content format. Anthropic's documentation says:

- The only absolute figure it publishes, about **3.5 English characters per token**, applies to models before Opus 4.7.
- Opus 4.7 and later models produce about 30% more tokens for the same text ([Glossary](https://platform.claude.com/docs/en/about-claude/glossary)), roughly 1x to 1.35x depending on content.
- Opus 5.5 uses that tokenizer ([Opus 5.5 migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide)).
- Sonnet 5.5 uses Sonnet 5's tokenizer, and the same text produces the same token counts ([What's new in Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)).
- Haiku 5.5 uses the same newer tokenizer as Claude 4.7 and later models ([Haiku 5.5 migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)).

Dividing 3.5 by 1.30 gives **about 2.69 characters per token**. The measured 2.73 for prose therefore sits on Anthropic's implied central value. The finding that Opus 5.5 and Sonnet 5.5 count identically confirms the documentation rather than discovering anything.

Independent April 2026 measurements on Opus 4.7 already put code at about 2.3 to 2.9 characters per token:

- ClaudeCodeCamp measured TypeScript at 2.69 and English prose at 3.60. Its published counts work out to about 2.86 for Python and about 2.47 for a CLAUDE.md file ([ClaudeCodeCamp](https://www.claudecodecamp.com/p/i-measured-claude-4-7-s-new-tokenizer-here-s-what-it-costs-you)).
- cometkim's corpus gives about 2.34 for a Go file ([cometkim gist](https://gist.github.com/cometkim/f5b382e9f69b3a35513ce66725b0e42e)).

The 2.49 code figure falls inside that range.

Two framings in the claim should change.

**The undercount baseline is out of date.** The 1.3 to 1.5x undercount is measured against folk rules that Claude Code no longer uses. In the 2.1.310 binary, `bytesPerTokenForModel` returns **4 for pre-4.7 models and 3 for every newer one**. That value drives the auto-compaction estimate, the file-read size gate and the skills budget. (Source: the Claude Code 2.1.310 binary, read on 2026-11-05; not a public source.) For ASCII text, bytes equal characters. Against 3, the measurement implies Claude Code underestimates by about **10% for prose (3 ÷ 2.73) and 20% for code (3 ÷ 2.49)**. This is the unpublished number that matters for decisions, because it shifts when automatic compaction fires. The file-read gate divides raw file bytes, before line-number prefixes are added, so its gap is likely larger still (inference). No published source was found for the 3.2 code baseline. The `token-count` crate, for comparison, uses 3.0 for code and 4.5 for prose ([token-count estimation.rs](https://docs.rs/crate/token-count/0.4.0/source/src/tokenizers/claude/estimation.rs)).

**2.73 is not a general prose figure.** Clean English measured 3.60 on the same tokenizer. The gap plausibly comes from Markdown content and the Read tool's right-aligned line-number prefixes, which no source has measured. The figure should be labelled "Read-tool output", not "prose".

What is new is an absolute figure on the 5.5 generation, on Read-tool output, with a per-file spread of 12%. No published Claude measurement gives a spread bound.

**Verdict: partly new.** High confidence, because the comparison rests on Anthropic's own documentation.

### What smart-compact can claim, and the claims to drop

The author's evidence points the same way as the literature, but it is thin. All three of the following are the author's own unreplicated measurements:

- **Forced automatic-compaction A/B.** With the contract, all three open questions kept their recommendations verbatim in 3 of 3 runs; without it, in none of 3 runs. (Re-graded from the logs on 2026-11-05; the README had said one run per arm. Each arm mixed two runs of 0.2 and one of 0.3.) The run is the unit of replication, so a two-sided Fisher exact test on 3 against 0 runs gives p = 0.10.
- **Fork versus manual comparison.**
  - **0.4.0:** fork-written checkpoints matched manual saves on all rubric lines in 3 of 3 pairs.
  - **0.5.0:** they matched the improved manual save in only 2 of 3, and a blind judge scored the fork 60 of 75 against 65.
  - **0.5.1, after a retune:** they matched or beat it on every line in 5 of 5 pairs, with criteria fixed before the run.
  - **The judge on 0.5.1:** a clean headless judge scored each checkpoint against its own session, tool calls included, and gave the fork 106 of 125 against 100. The fork scored higher in 3 pairs and lower in 2.
  - **What the two measures show:** manual saves are themselves written by the model, and the author defined the rubric, so the rubric lines measure consistency rather than correctness. The judge is the correctness evidence, at one judgment per checkpoint, and both arms ran with the author's settings hooks active.
- **229-session analysis.** The context lost after compactions was standing rules and pending decision lists. This is one user's history.

The findings are consistent with independent work:

- ConstraintRot found that soft organizational policies decay 8.3 times more than hard safety norms, and that violations track the summarizer, not the agent ([arXiv 2606.22528](https://arxiv.org/html/2606.22528v2)).
- CONPACT found agents deleting emails without approval in 30 of 100 sessions after compaction, against none before ([arXiv 2608.11242](https://arxiv.org/abs/2608.11242)).

ARCBench adds the caution every write-up needs. Most violations after compaction happen while the rule is still in the compacted history, so preserving text does not guarantee compliance ([arXiv 2611.03223](https://arxiv.org/abs/2611.03223)). Because no published study measures retention of pending decision lists, the 229-session loss profile is a modest contribution in its own right, provided it is presented as a single-user observation.

| Can claim, dated to a 2026-11-05 survey | Should not claim |
|---|---|
| A guard that refuses a checkpoint which silently drops a standing rule or open decision held by the previous checkpoint, not found in any surveyed agent, mod or framework | First to inject instructions into automatic compaction (at least five mods, plus Codex, Roo, Kilo and the Claude API do it) |
| Mechanical capture of the latest pending numbered decision list into the compaction instructions | First to checkpoint state before compaction (compact-plus, Token Optimizer, MemGPT in 2023) |
| A contract whose categories (open numbered decisions with recommendations kept verbatim, approvals with their conditions) appear in no surveyed prompt | First to fork a same-model, cached, tools-denied conversation at compaction (bindwright, handoff-compact, kzarzycki; Anthropic's background compaction) |
| Fork-written checkpoints at engine compactions, validated and corrected like a manual save, with the stock summary kept | That Claude Code cannot steer automatic compaction (mods can, through `session.compact` instructions) |
| Rehydration that skips files Claude Code already re-attached | That rules which are preserved are therefore followed (ARCBench), or that the A/B is conclusive (3 runs per arm) |
| Characters per token measured on Claude 5.5 Read-tool output, with a per-file spread | That 4 characters per token is what Claude Code assumes (it uses 3 bytes per token for 4.7 and later), or that 2.73 is general English prose |
| The integrated pipeline: contract, capture, guard and checked fork together | That the 229-session loss profile generalizes beyond one user |

Two presentation hazards remain.

**The name is taken twice.** hellosverre/smart-compact (★4) handles compaction timing and offers a `request_compact` tool ([hellosverre/smart-compact](https://github.com/hellosverre/smart-compact)). The ryanportfolio skill described under mechanism (1) carries the same name. If ryanportfolio is not the author's account, reviewers will find both.

**The novelty window is measured in weeks.** The nearest analogues appeared within days of mods going default-on. "Not found as of 2026-11-05" will hold up; "first" will not.

### Conclusion

The field has settled what a compaction summary should contain. Goal, constraints, decisions, progress, files and next steps appear in the prompts of Codex, Zed, Kiro, OpenHands, Gemini and most Claude Code mods, and 2026 research shows that asking for these things does not keep them. The open frontier is enforcement: deterministic checks that each summary and its on-disk twin still hold what the last one held, and mechanical capture of state the model would otherwise paraphrase. smart-compact's defensible identity sits there. Anthropic declined to build that layer natively in spring 2026, before mods made it buildable by third parties. The plugin's strongest ground is the category with no native fallback at all, pending decisions and approvals with conditions, since standing rules can at least be parked in CLAUDE.md.

Two pieces of work would turn the presentation from plausible to convincing. The first is to replicate the forced-compaction A/B over several runs per arm, and to add an arm that appends the captured decision list after the summary instead of inside the instructions. That tests both the effect size and the placement choice that separates smart-compact from Constraint Pinning. The second is to publish the 229-session loss analysis with its method. That would fill a measurement gap no published study covers, and it is a more durable claim than any mechanism's novelty, because a new mod next week cannot overtake it.
