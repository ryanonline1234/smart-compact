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

Checkpoints are plain markdown in `~/.claude/checkpoints/<project-slug>/`. The newest ten are kept; older ones move to `archive/`.

## The save suggestion

When context passes a size you choose, the plugin suggests `/smart-compact:save` once: a transcript line, plus a Tab suggestion in the terminal. It never saves on its own. The default threshold is 60% of the model's context window. To change it, set `suggestAt` in tokens (`-1` turns it off) in `/config`, with `/plugin configure smart-compact@smart-compact`, or in settings:

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

- **Hooks:** `session.start` (registers its tool), `tool.call` (its own tool only), `session.compact` (observes the outcome), `classic.SessionStart` and `classic.UserPromptSubmit` (to learn the transcript's path), `turn.complete`.
- **Calls:** reads files listed in your checkpoint and the session transcript; reads `HOME`; runs `/compact`; writes transcript notices and a prompt suggestion. No network, no file writes, no processes.

## Develop

```bash
claude plugin validate .                 # manifest, hooks, calls
claude plugin test .                     # 25 unit tests
python3 scripts/e2e.py                   # full save → compact → rehydrate run, about two minutes
python3 scripts/calibrate.py FILE...     # measure chars per token on your own files
```

Load the working copy into a session with `claude --plugin-dir .`.

## Known limits

- CJK text is unmeasured; the estimate assumes one character per token.
- Detecting re-attached files reads Claude Code's transcript format, which can change between releases.
- The engine's "after" token count leaves out the system prompt and tool definitions, so the notice says so instead of inventing a total.
- If Claude Code auto-compacts before you save, there is no checkpoint to rehydrate from. The save suggestion exists to get you there first.

## License

MIT
