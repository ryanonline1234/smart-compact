# smart-compact

Checkpoint a Claude Code session before it compacts, compact it automatically, and rehydrate on your terms, with a measured estimate of what rehydrating brings back.

**Site:** [smart-compact.vercel.app](https://smart-compact.vercel.app)

`/compact` replaces your conversation with one summary, and that summary decides what survives. smart-compact saves a curated checkpoint to disk first: your directives, decisions, dead ends, exact strings that must survive verbatim, and a manifest of what to re-read. Then it compacts for you. After compaction it tells you exactly what `/smart-compact:rehydrate` would put back and what that costs, so rebuilding is a choice instead of a guess.

```
/smart-compact:save          checkpoint to disk; compaction queued for the end of the turn
(automatic)                  the plugin runs /compact with a pointer to the checkpoint
/smart-compact:rehydrate     your call: re-read the checkpoint and its manifest, up to a budget
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

Requires Claude Code 2.1.309 or later with mods (function hooks) enabled, which is the default from 2.1.287. Tested end to end on 2.1.310 in stream-json mode, the mode the desktop app runs sessions in; the same hooks, before packaging, ran in the desktop app on 2.1.309.

```bash
claude plugin marketplace add ryanonline1234/smart-compact
claude plugin install smart-compact@smart-compact
```

Inside a session, `/plugin marketplace add ryanonline1234/smart-compact`, then `/plugin install smart-compact@smart-compact`, then `/reload-plugins`.

## Commands

| Command | What it does |
|---|---|
| `/smart-compact:save [budget]` | Writes a checkpoint, then compacts when the turn ends. `budget` caps what a later rehydrate re-reads; the default is `150k`. |
| `/smart-compact:rehydrate [path] [budget]` | Reads the checkpoint and its manifest, skipping anything already in context, and reports what it re-read, what it skipped, and why. Only you can start it. |

Checkpoints are plain markdown in `~/.claude/checkpoints/<project-slug>/`, keyed by the project's git root rather than the shell's directory. The newest ten are kept; older ones move to `archive/`.

## Long-horizon sessions

Built for sessions that run for days: many rounds of feedback, several compactions, decisions answered with a short "go with recs". Measured on the author's own sessions (229 interactive sessions, 35 compactions), the context that got lost was standing rules and pending asks, and 5 of 7 losses followed compactions Claude Code started on its own. So 0.2 adds:

- **A summary contract on every compaction, automatic ones included.** The plugin adds instructions to every compaction of the main conversation: keep standing rules with date and scope, every open numbered question with its recommendation (verbatim, so a later "go with recs" still points at the same list), approvals with their conditions, unfinished requests, iteration pointers, and methods that worked. It also re-states the latest checkpoint's pointer, so an opt-in rehydrate survives later compactions. In a forced automatic compaction with the contract on, the summary kept all three open questions and their recommendations; with it off, it kept none of them. Both kept the user's two rules. That is one run per arm.
- **Standing rules and open decisions lead the checkpoint and override the rest.** The task state has to agree with them.
- **A carry-forward guard.** Each checkpoint names the one before it. The save tool refuses a checkpoint that drops a standing rule or an open decision the previous one held, until each is carried, or written as `retired:`, `answered:` or `promoted to <file>:`.
- **Section targets.** A manifest can name `STATE.md#Next action` or `DECISIONS.md#last 3` instead of whole files, which grow large and are rewritten every round.

### Adapting to the moment

Measured on the same sessions, a pending numbered list is what a reply like "go with recs" answers, so the plugin keeps it:

- **A checkpoint at every compaction Claude Code starts on its own** (at its threshold, precomputed in the background, or a bare `/compact`), at the quality of a manual save. A fork of the session writes it, alongside the summary. The fork is the same model reading the same transcript, with tools denied; its answer goes only to the file, and the session stays the same session. It gets the save skill's rules, the template, your profile, the previous checkpoint, the pending decision, and the facts a save would look up with tools (git state, the state files' next action and open questions, earlier checkpoints). The plugin checks the result like a manual save, with the carry-forward guard and manifest measurement. If a check refuses it, the plugin asks for a corrected version, up to twice, then carries any dropped item verbatim and marks it. A plugin-written checkpoint stands in when no fork can run. In a 3-pair A/B against manual saves, the fork matched the manual save on every rubric line in every pair. A blind judge scored each checkpoint against its own session and rated the fork at least as high on all five dimensions in all three pairs. Option `checkpointOnCompact` (default on).
- **The pending decision list, captured mechanically.** At every compaction it finds the newest numbered list that asks something (a `?` or a recommendation), or a question asked with buttons, within the last six user messages. It quotes the list verbatim into the compaction instructions, with the user's reply if there is one, so "go with recs" never depends on the summarizer noticing the list.

### Profile

`~/.claude/smart-compact/profile.md` (or the file `SMART_COMPACT_PROFILE` names) tailors all of this. Its **Summary contract** section replaces the built-in contract on every compaction; its **Save** and **Rehydrate** sections add to those commands. Edits apply from the next compaction.

```markdown
## Summary contract
- Every standing rule I stated, verbatim, with its date and scope.
- Every open numbered question with each recommendation, verbatim, and the button labels offered.
- The handoff number, branch, worktree, and what is merged and deployed.

## Save
- Manifest defaults: STATE.md#Next action, STATE.md#Open questions, DECISIONS.md#last 3.
```

## The save suggestion

When context passes a size you choose, the plugin suggests `/smart-compact:save` once: a transcript line, plus a Tab suggestion in the terminal. It never saves on its own. The default threshold is 60% of the point where Claude Code compacts on its own, read from the session; a `suggestAt` in tokens can only bring it earlier, and `-1` turns it off. Set it in `/config`, with `/plugin configure smart-compact@smart-compact`, or in settings:

```json
{
  "pluginConfigs": {
    "smart-compact@smart-compact": { "options": { "suggestAt": 400000 } }
  }
}
```

## How the estimate is measured

- **At save time**, before anything is wiped, the plugin reads the checkpoint's rehydration manifest. It measures every file it lists on disk, honoring line ranges and the Read tool's 2,000-line default. Commands and searches can't be measured, so they keep the checkpoint's own guesses.
- **Token ratios** come from measuring the Read tool's real output on Claude 5 models: 2.73 characters per token for prose and 2.49 for code, line-number prefixes included. Sonnet 5.5 and Opus 5.5 counted identically on every file. The common rules of thumb (4 and 3.2) undercount by 1.3 to 1.5 times.
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
| **All seven** | **101,151** | **42,375** | **42,598** | **+0.5%** |

In a full end-to-end run, the notice estimated ≈14.3k for rehydrate. The two files it then read cost about 15.2k at measured rates, and context grew 15.5k including the model's own tool calls. Reproduce both with the scripts below.

## What the plugin's code can do

It is a mod: code that runs inside Claude Code with your permissions. `claude plugin validate` lists exactly what it touches:

- **Hooks:** `session.start` (registers its tool), `tool.call` (its own tool), `session.compact` (adds the summary contract and the pending list, writes the checkpoint for a compaction it did not start, and observes the outcome), `classic.SessionStart` and `classic.UserPromptSubmit` (to learn the transcript's path), `turn.complete`.
- **Calls:** reads files listed in your checkpoint, the previous checkpoint, the profile and the session transcript; reads `HOME` and `SMART_COMPACT_PROFILE`; runs `/compact`; writes transcript notices and a prompt suggestion. At a compaction it did not start, it also runs read-only git commands (`rev-parse`, `status`, `log`, `ls-files`) in the project, sends one fork of the session (and up to two corrections) through the session's own client, and writes the checkpoint under `~/.claude/checkpoints/`. No other network, no other file writes. Turn the contract off with `summaryContract`, the compaction checkpoints with `checkpointOnCompact`.

## Develop

```bash
claude plugin validate .                 # manifest, hooks, calls
claude plugin test .                     # unit tests
python3 scripts/e2e.py                   # full save → compact → rehydrate run, about two minutes
python3 scripts/e2e_long.py              # two saves with carry-forward, one compaction per queue, and an automatic compaction with the contract on and off
python3 scripts/e2e_long.py --scenario ab --model claude-opus-5-5   # the quality gate: compaction checkpoints vs manual saves, 3 pairs and a blind judge
python3 scripts/calibrate.py FILE...     # measure chars per token on your own files
```

Load the working copy into a session with `claude --plugin-dir .`.

## Known limits

- CJK text is unmeasured; the estimate assumes one character per token.
- Detecting re-attached files reads Claude Code's transcript format, which can change between releases.
- The engine's "after" token count leaves out the system prompt and tool definitions, so the notice says so instead of inventing a total.
- A checkpoint written at Claude Code's own compaction cannot update the project's state files or rules doc, as a manual save does first; it lists those updates as to-dos.
- Precomputed compactions (the summary built in the background) are covered by unit tests only: `claude -p` did not precompute in testing.
- The carry-forward guard matches items by shared words. It can flag a rule that was reworded heavily; carrying it verbatim or retiring it by name always satisfies it.

## License

MIT
