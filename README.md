# smart-compact

Enforcement for Claude Code's compaction: what you decided and told it to keep survives, checked rather than hoped for.

**Site:** [smart-compact.vercel.app](https://smart-compact.vercel.app)

When Claude Code compacts, one summary decides what survives. Measured over the author's sessions, what got lost was standing rules ("never deploy without asking") and pending decision lists, the numbered questions a later "go with recs" answers. smart-compact keeps both, and it checks that they were kept:

- **Every compaction carries a summary contract,** Claude Code's own automatic ones included. The contract asks for standing rules, open numbered decisions with their recommendations verbatim, and approvals with their conditions.
- **The latest pending decision list is captured mechanically** and quoted into the compaction instructions word for word, so "go with recs" still points at the same list afterwards.
- **A checkpoint on disk, with a carry-forward guard.** `/smart-compact:save` writes a checkpoint before compacting. The guard refuses a new checkpoint that silently drops a rule or open decision the previous one held. At a compaction you didn't start, a fork of the session writes the checkpoint alongside the summary, and the plugin checks and corrects it like a save.
- **Rehydrating is measured, and yours to call:** the plugin tells you what `/smart-compact:rehydrate` would put back and what it costs, minus the files Claude Code already re-attached.

```
/smart-compact:save          checkpoint to disk; compaction queued for the end of the turn
(automatic)                  the plugin runs /compact with a pointer to the checkpoint
/smart-compact:rehydrate     re-read the checkpoint and its manifest, up to a budget
```

After the compaction, the plugin's notice reads like this:

```
smart-compact: compacted (91k → 28k tokens); the system prompt and tools come on top. Checkpoint: ~/.claude/checkpoints/…/20261103T233304Z-bug-hunt.ckpt.md
Rehydrate would add ≈14k tokens, measured at save, budget 150k:
  files: 2 ≈14k measured — docs/STATE.md 7.6k (why it is listed); src/auth.ts 6.7k (why it is listed)
  checkpoint itself: already back
  already back after compaction, so skipped: src/decoder.py
Send /smart-compact:rehydrate to rebuild context from it, or keep working from the summary.
```

## Install

Requires Claude Code 2.1.309 or later with mods (function hooks) enabled, the default from 2.1.287. Tested end to end on 2.1.310 in stream-json mode, the mode the desktop app runs sessions in.

```bash
claude plugin marketplace add ryanonline1234/smart-compact
claude plugin install smart-compact@smart-compact
```

Inside a session: `/plugin marketplace add ryanonline1234/smart-compact`, then `/plugin install smart-compact@smart-compact`, then `/reload-plugins`.

## Commands

| Command | What it does |
|---|---|
| `/smart-compact:save [budget]` | Writes a checkpoint, then compacts when the turn ends. `budget` caps what a later rehydrate re-reads; the default is `150k`. |
| `/smart-compact:rehydrate [path] [budget]` | Reads the checkpoint and its manifest, skipping anything already in context, and reports what it re-read, what it skipped, and why. You start it, or the plugin does after a compaction when you turn on `autoRehydrate`. |

Checkpoints are plain markdown in `~/.claude/checkpoints/<project-slug>/`, keyed by the project's git root rather than the shell's directory. The newest ten are kept; older ones move to `archive/`.

## What it keeps, and how

Built for sessions that run for days: many rounds of feedback, several compactions, decisions answered with a short "go with recs". Over 229 of the author's interactive sessions, agents reading the transcripts judged what was lost after compactions: standing rules and pending asks, in 7 of 35 compactions, 5 of them automatic. A scripted re-measurement ([`docs/05-session-study.md`](docs/05-session-study.md)) reproduces the population and finds that 78% of "go with recs" replies answer a numbered list. A keyword proxy can't reproduce the loss judgments, so that figure stays agent-judged. It is one person's sessions, not a general result.

- **The summary contract.** The plugin adds instructions to every compaction of the main conversation:
  - keep standing rules, with their date and scope;
  - keep every open numbered question with its recommendation, verbatim;
  - keep approvals with their conditions, unfinished requests, iteration pointers and methods that worked;
  - keep the latest checkpoint's pointer.

  **Measured:** in a forced automatic compaction with the contract on, the summary kept all three open questions and their recommendations verbatim in 3 of 3 runs; with it off, it kept none, in 3 of 3 runs. Both arms kept the user's two rules. Three runs per arm is small (two-sided Fisher on runs, p = 0.10). Each arm mixed two runs of 0.2 and one of 0.3.
- **The pending list, captured mechanically.** At every compaction, the plugin finds the newest numbered list that asks something (a `?` or a recommendation), or a question asked with buttons, within the last six user messages. It quotes that list verbatim into the compaction instructions, with your reply if there is one. Whether quoting it inside the instructions beats appending it after the summary is being tested: `docs/04-placement-experiment.md`.
- **Standing rules and open decisions lead the checkpoint and override the rest.** The task state has to agree with them.
- **The carry-forward guard.** Each checkpoint names the one before it. The save tool refuses a checkpoint that drops a standing rule or an open decision the previous one held, until each is carried, or written as `retired:`, `answered:` or `promoted to <file>:`. It also refuses an `answered:` line that doesn't quote what you said. Only you settle a question put to you.
- **Checkpoints at compactions you didn't start** (Claude Code's threshold, a precomputed summary, a bare `/compact`).
  - **How it's written:** a fork of the session writes it, alongside the summary: the same model reading the same transcript, with tools denied (Claude Code's `$.model.fork`). Its answer goes only to the file.
  - **What the fork gets:** the save skill's rules, the template, your profile, the previous checkpoint, the pending decision, and the facts a save would look up with tools (git state, the state files' next action and open questions).
  - **How it's checked:** like a manual save, with corrections asked for up to twice, then any dropped item carried verbatim and marked.
  - **Measured:**
    - Against 0.4.0's manual save, it matched on every rubric line in 3 of 3 A/B pairs.
    - Against 0.5.0's improved manual save, it matched in 2 of 3 pairs. A blind judge scored the fork 60 of 75 and the manual save 65.
    - Tuning is under way.

  Option `checkpointOnCompact` (default on).
- **Section targets.** A manifest can name `STATE.md#Next action` or `DECISIONS.md#last 3` instead of whole files, which grow large and are rewritten every round.

Keeping a rule in the summary is not the same as the model following it. Published work finds most violations after compaction happen while the rule is still in the compacted history (ARCBench, [arXiv 2611.03223](https://arxiv.org/abs/2611.03223)). smart-compact makes sure the rule is there; it can't make the model obey it.

### Profile

`~/.claude/smart-compact/profile.md` (or the file `SMART_COMPACT_PROFILE` names) tailors all of this. Its **Summary contract** section replaces the built-in contract on every compaction. Its **Save** and **Rehydrate** sections add to those commands. Edits apply from the next compaction.

```markdown
## Summary contract
- Every standing rule I stated, verbatim, with its date and scope.
- Every open numbered question with each recommendation, verbatim, and the button labels offered.
- The handoff number, branch, worktree, and what is merged and deployed.

## Save
- Manifest defaults: STATE.md#Next action, STATE.md#Open questions, DECISIONS.md#last 3.
```

## Settings

Set them in `/config`, with `/plugin configure smart-compact@smart-compact`, or in settings:

```json
{
  "pluginConfigs": {
    "smart-compact@smart-compact": { "options": { "suggestFrom": 600000, "suggestTo": 700000, "autoRehydrate": "after-save" } }
  }
}
```

| Option | Default | What it does |
|---|---|---|
| `suggestAt` | `0` | Offer `/smart-compact:save` once context passes this many tokens. `0` means 60% of the point where Claude Code compacts on its own; a number can only bring it earlier; `-1` turns the offer off. Ignored when a band is set. |
| `suggestFrom`, `suggestTo` | `0` | A band instead of a single point. Inside it, the offer comes at the first turn end after a commit, merge, deploy or state-file write, where saving is cheapest, and at the band's top otherwise, so the point varies with each session's work. The band always stays below 90% of the point where Claude Code compacts on its own. |
| `autoRehydrate` | `off` | `after-save`: once a save's compaction finishes, the plugin runs `/smart-compact:rehydrate auto`, which asks nothing and starts no work. `always`: also after Claude Code's own compactions, once their checkpoint is written. When Claude Code compacts on your next message, that message is answered from the summary first. |
| `checkpointOnCompact` | `true` | Write a checkpoint at every compaction the plugin did not start (see above). |
| `summaryContract` | `true` | Add the summary contract and the pending list to every compaction. |

**The offer comes from Claude.** The plugin hands a one-line note to the model with your next message, so its reply ends by offering the save. A transcript line and, in the terminal, a Tab suggestion come with it. The plugin never saves on its own. In a test session, right after a commit inside the band, Claude answered "What is 2 + 2?" with: "2 + 2 = 4. A round just closed with that commit, so `/smart-compact:save` is cheap now if you want to checkpoint and compact this session."

## How the estimate is measured

- **At save time**, before anything is wiped, the plugin reads the checkpoint's rehydration manifest. It measures every file listed there on disk, honoring line ranges and the Read tool's 2,000-line default. Commands and searches can't be measured, so they keep the checkpoint's own guesses.
- **Token ratios** come from measuring the Read tool's real output, line-number prefixes included, on Claude 5.5 models: 2.73 characters per token for markdown and prose files, 2.49 for code. Sonnet 5.5 and Opus 5.5 counted identically on every file, as Anthropic documents for the tokenizer since Opus 4.7.
  - **Not general prose:** clean English on the same tokenizer measures about 3.6 characters per token ([ClaudeCodeCamp](https://www.claudecodecamp.com/p/i-measured-claude-4-7-s-new-tokenizer-here-s-what-it-costs-you)). These are Read-tool output figures.
  - **Against Claude Code's own estimate:** for 4.7 and later models, Claude Code (2.1.310) assumes 3 bytes per token. On this kind of text, that runs about 10% low for markdown and prose and 20% low for code. The old 4-characters rule runs 1.3 to 1.5 times low.
- **After compaction**, Claude Code re-attaches up to five recent small files, and rehydrate skips anything already in context. The plugin reads the session transcript to see exactly which files came back, and leaves them out of the estimate.

| File | Characters | Real tokens | Estimate | Error |
|---|---|---|---|---|
| Claude Code docs page (markdown) | 19,943 | 7,665 | 7,647 | −0.2% |
| Claude Code docs page 2 (markdown) | 9,228 | 3,545 | 3,464 | −2.3% |
| synthetic notes (markdown) | 8,710 | 3,108 | 3,244 | +4.4% |
| JavaScript library file | 19,060 | 8,452 | 8,602 | +1.8% |
| Python `json/decoder.py` | 12,872 | 5,642 | 5,756 | +2.0% |
| Python `json/encoder.py` | 16,148 | 6,433 | 7,200 | +11.9% |
| synthetic TypeScript | 15,190 | 7,530 | 6,685 | −11.2% |
| All seven | 101,151 | 42,375 | 42,598 | +0.5% |

Per file, the estimate is within 12%. The +0.5% for all seven is errors cancelling out, not per-file accuracy.

In a full end-to-end run, the notice estimated ≈14.3k for rehydrate. The two files it then read cost about 15.2k at measured rates, and context grew 15.5k including the model's own tool calls. Reproduce both with the scripts below.

## Prior art, and what is new

Surveyed on 2026-11-05 across Claude Code's docs, its mod and plugin ecosystem, 14 other coding agents, agent-memory frameworks and 2026 papers. "Not found" means not in that survey, not proof that nothing exists. The full survey, with sources and confidence per mechanism: [`docs/03-novelty-assessment.md`](docs/03-novelty-assessment.md).

**Not new, and credited:**
- **Instructions in automatic compactions.** Other mods inject them too: [bindwright](https://github.com/starfoxcom/bindwright) compact-handoff, [handoff-compact](https://github.com/trytofly94/handoff-compact) and others. So do Codex's `compact_prompt`, Roo, Kilo and the Claude API's `instructions` field.
- **Checkpointing before compaction:** [compact-plus](https://github.com/u-ichi/compact-plus), [Token Optimizer](https://github.com/alexgreensh/token-optimizer), and MemGPT in 2023.
- **Forking the session at compaction:** bindwright's shadow mode, handoff-compact, and Anthropic's background compaction. The fork itself is Claude Code's `$.model.fork`.

**Not found elsewhere:**
- **The carry-forward guard,** which refuses a checkpoint that drops a rule or open decision the previous one held. The nearest work is Gemini CLI's constraint merge, which carries constraints forward but can still drop them, [Constraint Pinning](https://arxiv.org/html/2606.22528v2), and the [compacli-harness](https://github.com/rajesamp/compacli-harness) design.
- **Mechanical capture of the pending decision list** into the compaction instructions.
- **The contract's categories:** open decisions with their recommendations, and approvals with their conditions.
- **Checking and correcting a fork-written checkpoint** while the stock summary stays in place.
- **Rehydration that skips the files Claude Code itself re-attached.**

Two other projects share the name: [hellosverre/smart-compact](https://github.com/hellosverre/smart-compact), about when to compact, and a skill in ryanportfolio/winuse-mcp.

## What the plugin's code can do

It is a mod: code that runs inside Claude Code with your permissions. `claude plugin validate` lists exactly what it touches:

- **Hooks:**
  - `session.start` (registers its tool);
  - `tool.call` (its own tool);
  - `session.compact` (adds the summary contract and the pending list, writes the checkpoint for a compaction it did not start, and observes the outcome);
  - `classic.SessionStart` and `classic.UserPromptSubmit` (the transcript's path, and the save offer);
  - `turn.complete`.
- **Calls:**
  - reads files listed in your checkpoint, the previous checkpoint, the profile and the session transcript;
  - reads `HOME` and `SMART_COMPACT_PROFILE`;
  - runs `/compact`, and `/smart-compact:rehydrate` when `autoRehydrate` is on;
  - writes transcript notices and a prompt suggestion.
- **At a compaction it did not start, it also:**
  - runs read-only git commands (`rev-parse`, `status`, `log`, `ls-files`) in the project;
  - sends one fork of the session, and up to two corrections, through the session's own client;
  - writes the checkpoint under `~/.claude/checkpoints/`.

  No other network calls, no other file writes.

Turn the contract off with `summaryContract`, the compaction checkpoints with `checkpointOnCompact`.

## Develop

```bash
claude plugin validate .                 # manifest, hooks, calls
claude plugin test .                     # unit tests
python3 scripts/e2e.py                   # full save → compact → rehydrate run, about two minutes
python3 scripts/e2e_long.py              # two saves with carry-forward, one compaction per queue, and an automatic compaction with the contract on and off
python3 scripts/e2e_long.py --scenario ab --model claude-opus-5-5   # the quality gate: compaction checkpoints vs manual saves, 3 pairs and a blind judge
python3 scripts/calibrate.py FILE...     # measure chars per token on your own files
python3 scripts/sessions_study.py        # what compaction does to your own long sessions (aggregates only)
```

Load the working copy into a session with `claude --plugin-dir .`.

## Known limits

- **The evidence is small:** one person's sessions, a few runs per arm, a rubric the author wrote. Each claim above says how it was measured.
- **Mods are new** (default-on since 2.1.287). The `session.compact` surface the plugin relies on is fully documented only in Claude Code's published type file, and open issues report rough edges around it.
- **CJK text is unmeasured;** the estimate assumes one character per token.
- **Re-attached files** are detected by reading Claude Code's transcript format, which can change between releases.
- **The engine's "after" token count** leaves out the system prompt and tool definitions, so the notice says so instead of inventing a total.
- **No state-file updates at a compaction you didn't start.** That checkpoint can't update the project's state files or rules doc the way a manual save does first; it lists those updates as to-dos.
- **Precomputed compactions** (the summary built in the background) are covered by unit tests only: `claude -p` did not precompute in testing.
- **The carry-forward guard matches items by shared words.** It can flag a rule that was reworded heavily; carrying it verbatim or retiring it by name always satisfies it.

## License

MIT
