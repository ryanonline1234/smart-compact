"""Long-horizon end-to-end checks on a real model, in throwaway folders.

  auto   Does the summary contract reach the engine's OWN compaction? Two arms,
         contract on and off: state two standing rules, get three numbered
         questions with recommendations, then read files until Claude Code
         auto-compacts (window forced to 100k). Compare what each summary kept.
  saves  Two saves in one session started at "/", as the desktop app runs:
         project-root keying, carry-forward of rules and open decisions, an
         approval with a condition, and section targets in the manifest.
  boundary  autoSave "boundary" with the window forced to 100k: the plugin
         should save on its own at a turn's end before the overflow, and the
         compaction summary should quote the pending list's lines verbatim.
  double  A second queue call sent while a save is still running (as when the
         user types /smart-compact:save during an automatic save): the
         session should compact once, not twice.

Usage:
    python3 scripts/e2e_long.py [--scenario auto|saves|boundary|double|all] [--model claude-sonnet-5-5] [--claude PATH]
Costs a few dollars and takes about ten minutes for both. Uses this repo as the
plugin (--plugin-dir) and hides other plugin folders (CLAUDE_CODE_PLUGIN_DIRS).
"""

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from session import Session, find_claude, read_log

REPO = Path(__file__).resolve().parent.parent
OUT = Path(__file__).parent / "out"
MARKER = "SC-CONTRACT-MARKER"
BASE_ENV = {"CLAUDE_CODE_PLUGIN_DIRS": "/nonexistent"}


def summary_text(rows: list[dict]) -> str:
    """The last compaction summary, from the session's transcript: a compaction mid-turn does not stream it."""
    sid = next((r.get("session_id") for r in rows if r.get("subtype") == "init"), None)
    found = list((Path.home() / ".claude" / "projects").glob(f"*/{sid}.jsonl")) if sid else []
    text = ""
    for line in (found[0].read_text().splitlines() if found else []):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("isCompactSummary"):
            c = row["message"]["content"]
            text = c if isinstance(c, str) else "".join(x.get("text", "") for x in c if isinstance(x, dict))
    return text


def assistant_texts(rows: list[dict]) -> list[str]:
    out = []
    for r in rows:
        if r.get("type") == "assistant":
            out += [b.get("text", "") for b in r["message"].get("content", []) if b.get("type") == "text"]
    return out


def tool_results(rows: list[dict], name_part: str) -> list[tuple[bool, str]]:
    ids = {}
    found = []
    for r in rows:
        if r.get("type") == "assistant":
            for b in r["message"].get("content", []):
                if b.get("type") == "tool_use" and name_part in b.get("name", ""):
                    ids[b["id"]] = True
        if r.get("type") == "user" and isinstance((r.get("message") or {}).get("content"), list):
            for b in r["message"]["content"]:
                if b.get("type") == "tool_result" and b.get("tool_use_id") in ids:
                    c = b.get("content")
                    text = c if isinstance(c, str) else "".join(x.get("text", "") for x in c if isinstance(x, dict))
                    found.append((bool(b.get("is_error")), text))
    return found


def verbatim_lines(lines: list[str], hay: str) -> int:
    """How many of the asked lines appear in the summary character for character (ends trimmed)."""
    return sum(1 for l in lines if l.strip() and l.strip() in hay)


def words_hit(needle: str, hay: str, k: int = 6) -> bool:
    """True when the first k content words of needle all appear in hay."""
    ws = [w for w in re.findall(r"[a-z0-9']+", needle.lower()) if len(w) > 3][:k]
    h = hay.lower()
    return bool(ws) and all(w in h for w in ws)


# ---------------------------------------------------------------- auto

def run_auto_arm(claude: str, model: str, contract: bool, root: Path) -> dict:
    proj = root / ("on" if contract else "off")
    proj.mkdir()
    para = "The refresh window should be computed from the server clock, not the client clock, because mobile clients drift by minutes. "
    for i in range(1, 8):
        (proj / f"notes-{i}.md").write_text("\n".join(f"Note {i}.{j}: {para * 3}" for j in range(90)))
    profile = root / "profile.md"
    profile.write_text(
        "# test profile\n## Summary contract\n"
        "- Every standing rule the user stated, verbatim, with date and scope.\n"
        "- Every numbered question the assistant asked that is still open: numbering, options and each recommendation, verbatim.\n"
        f"- End the summary with the line: {MARKER}\n"
    )
    env = {**BASE_ENV, "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "100000", "SMART_COMPACT_PROFILE": str(profile)}
    extra = ["--plugin-dir", str(REPO), "--allowedTools", "Read"]
    if not contract:
        extra += ["--settings", json.dumps({"pluginConfigs": {"smart-compact@inline": {"options": {"summaryContract": False}}}})]
    log = OUT / f"auto-{'on' if contract else 'off'}-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    s = Session(claude, proj, model, log, extra, env)
    s.turn("Two standing rules for this project, from now on: you test your own work and never ask me to test; never push or deploy without my explicit OK. Reply only with: noted.")
    s.turn("Before we start, ask me exactly three numbered questions about how to organise the notes in this folder, each followed by your recommendation, in the form 'N. <question>? Rec: <recommendation>.' Do not read any files yet.")
    compacted = False
    for i in range(1, 8):
        s.turn(f"Read notes-{i}.md in full with the Read tool, then reply only with: read {i}.", timeout=300)
        if any(r.get("subtype") == "compact_boundary" for r in read_log(log)):
            compacted = True
            break
    s.close()
    rows = read_log(log)
    summary = summary_text(rows)
    asked = next((t for t in assistant_texts(rows) if re.search(r"^\s*1\.", t, re.M) and "Rec" in t), "")
    questions = [l.strip() for l in asked.splitlines() if re.match(r"^\s*\d\.", l)]
    return {
        "arm": "contract on" if contract else "contract off",
        "compacted": compacted,
        "marker": MARKER in summary,
        "rule_test": words_hit("test your own work never ask me to test", summary, 4),
        "rule_push": words_hit("never push or deploy without explicit", summary, 4),
        "questions_kept": sum(words_hit(q, summary) for q in questions),
        "questions_asked": len(questions),
        "recs_kept": sum(1 for q in questions if "Rec:" in q and words_hit(q.split("Rec:", 1)[1], summary, 4)),
        "questions_verbatim": verbatim_lines(questions, summary),
        "summary_chars": len(summary),
        "log": str(log),
    }


# ---------------------------------------------------------------- saves

STATE = """# STATE (overwrite in place)
Updated: 2026-11-04, round 5 merged.
Previous Updated line: 2026-11-03, round 4 merged.
Previous Updated line: 2026-11-02, round 3 merged.
""" + "\n".join(f"Previous Updated line: 2026-10-{d:02d}, an older round with a long note about what was built and measured." for d in range(1, 29)) + """

## Where things stand
Round 5 (the export check) is merged into main. Live is still round 4.

## Next action (one step)
Write HANDOFF/06 for the parts-cost check, then build it on branch cost-check.

## Open questions for Ryan
1. Deploy main with round 5 now? Rec: yes.
2. Use the supplier API or scrape the price pages for the cost check? Options: API, scrape. Rec: API.
3. Add a cost ceiling per build? Rec: yes, 150 dollars default.
"""


def write_fixture(root: Path) -> Path:
    fix = root / "proj"
    (fix / "HANDOFF").mkdir(parents=True)
    (fix / "STATE.md").write_text(STATE)
    (fix / "DECISIONS.md").write_text("# Decisions\n\n" + "\n\n".join(f"## 2026-10-{d:02d} — decision {d}\nWhy: a reason that took a paragraph to explain, with the alternative rejected." for d in range(10, 22)))
    (fix / "HANDOFF/02_RULES.md").write_text("# HANDOFF/02 — Binding rules\n- Never invent a part or link.\n- Missing data is unverified, never pass.\n")
    (fix / "HANDOFF/05_EXPORT_CHECK.md").write_text("# HANDOFF/05 — Export check\n## 1. Built\nThe export check.\n## 6. Decisions for Ryan\nSee STATE.md, Open questions.\n")
    env = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}
    for cmd in (["git", "init", "-q"], ["git", "add", "-A"], ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]):
        subprocess.run(cmd, cwd=fix, env=env, check=True)
    return fix


def checkpoint_dirs(fix: Path) -> list[Path]:
    """Folders keyed by this fixture: git may report /var/... where Python resolves /private/var/...."""
    tail = re.sub(r"[^A-Za-z0-9]", "-", f"{fix.parent.name}/{fix.name}")
    return [d for d in (Path.home() / ".claude" / "checkpoints").glob(f"*{tail}") if d.is_dir()]


def checkpoints_for(fix: Path) -> list[Path]:
    return sorted(f for d in checkpoint_dirs(fix) for f in d.glob("*.ckpt.md"))


def cleanup(fix: Path) -> None:
    for d in checkpoint_dirs(fix):
        for f in list(d.glob("*.ckpt.md")) + list((d / "archive").glob("*.ckpt.md")):
            f.unlink()
        for sub in (d / "archive", d):
            if sub.is_dir() and not any(sub.iterdir()):
                sub.rmdir()


def run_saves(claude: str, model: str, root: Path) -> dict:
    fix = write_fixture(root)
    log = OUT / f"saves-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    extra = ["--plugin-dir", str(REPO), "--permission-mode", "bypassPermissions"]
    s = Session(claude, Path("/"), model, log, extra, BASE_ENV)
    s.turn(
        f"We're working on the project at {fix}. Read {fix}/HANDOFF/05_EXPORT_CHECK.md and the 'Next action' and 'Open questions' "
        f"sections of {fix}/STATE.md (not the whole file). Standing rules from now on: you test your own work; never push without asking me. "
        "Then list the open decisions, numbered, each with your recommendation. Do not change any files."
    )
    s.turn("/smart-compact:save")
    first = s.wait(lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and e.get("plugin") == "smart-compact", 240)
    s.wait(lambda e: e.get("type") == "result", 20)
    s.turn("Go with recs on 1 and 3, but on 2 scrape the price pages instead. New rule from now on: keep commits small. Reply only with: noted.")
    s.turn("/smart-compact:save")
    second = s.wait(lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and e.get("plugin") == "smart-compact", 240)
    s.wait(lambda e: e.get("type") == "result", 20)
    s.close()
    rows = read_log(log)
    cps = checkpoints_for(fix)
    texts = [c.read_text() for c in cps]
    newest = texts[-1] if texts else ""
    fm = lambda t, k: (re.search(rf"^{k}:\s*(.+)$", t, re.M) or [None, ""])[1].strip()
    queue = tool_results(rows, "compact_after_turn")
    result = {
        "checkpoints": [c.name for c in cps],
        "keyed_by_project": bool(cps),
        "project_root": fm(newest, "project_root"),
        "second_previous_is_first": len(cps) >= 2 and fm(newest, "previous").endswith(cps[0].name),
        "rules_in_second": {k: words_hit(v, newest, 3) for k, v in {"test own work": "test your own work", "ask before push": "never push without asking", "small commits": "keep commits small"}.items()},
        "answered_with_condition": bool(re.search(r"answered[^\n]*(scrape|price pages)", newest, re.I)) or bool(re.search(r"scrape[^\n]*price", newest, re.I)),
        "section_targets": re.findall(r"\|\s*\d+\s*\|\s*Read\s*\|\s*([^|]*#[^|]*)\|", newest),
        "queue_calls": [("refused" if err else "queued") + ": " + text[:160] for err, text in queue],
        "notices": [n["text"].splitlines()[0][:140] for n in (first, second) if n],
        "log": str(log),
    }
    cleanup(fix)
    return result


# ---------------------------------------------------------------- boundary

def run_boundary(claude: str, model: str, root: Path) -> dict:
    proj = root / "boundary"
    proj.mkdir()
    para = "The refresh window should be computed from the server clock, not the client clock, because mobile clients drift by minutes. "
    for i in range(1, 8):
        (proj / f"notes-{i}.md").write_text("\n".join(f"Note {i}.{j}: {para * 3}" for j in range(90)))
    # 150k, not 100k: a session with many plugins starts near 70k, and a 100k window compacts near 70k.
    env = {**BASE_ENV, "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "150000"}
    extra = ["--plugin-dir", str(REPO), "--permission-mode", "bypassPermissions",
             "--settings", json.dumps({"pluginConfigs": {"smart-compact@inline": {"options": {"autoSave": "boundary"}}}})]
    log = OUT / f"boundary-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    s = Session(claude, proj, model, log, extra, env)
    s.turn("Two standing rules for this project, from now on: you test your own work and never ask me to test; never push or deploy without my explicit OK. Reply only with: noted.")
    s.turn("Before we start, ask me exactly three numbered questions about how to organise the notes in this folder, each followed by your recommendation, in the form 'N. <question>? Rec: <recommendation>.' Do not read any files yet.")
    is_auto_save = lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and "Saving now (autoSave)" in e.get("text", "")
    started = None
    for i in range(1, 8):
        s.send(f"Read notes-{i}.md in full with the Read tool, then reply only with: read {i}.")
        def hit(e):
            return e.get("type") == "result" or is_auto_save(e)
        first = s.wait(hit, 300)
        if first is not None and is_auto_save(first):
            started = first
            break
        # The notice lands at the turn's end, around the result: give it a moment before the next message.
        late = s.wait(is_auto_save, 5)
        if late is not None:
            started = late
            break
        if any(is_auto_save(r) for r in read_log(log)):
            started = next(r for r in read_log(log) if is_auto_save(r))
            break
        if any(r.get("subtype") == "compact_boundary" for r in read_log(log)):
            break
    # The automatic save runs as its own turn, then compacts: wait for the plugin's compaction notice.
    done = s.wait(lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and "compacted" in e.get("text", ""), 420) if started else None
    s.wait(lambda e: e.get("type") == "result", 30)
    s.close()
    rows = read_log(log)
    summary = summary_text(rows)
    asked = next((t for t in assistant_texts(rows) if re.search(r"^\s*1\.", t, re.M) and "Rec" in t), "")
    questions = [l.strip() for l in asked.splitlines() if re.match(r"^\s*\d\.", l)]
    boundaries = [r.get("compact_metadata", {}).get("trigger") for r in rows if r.get("subtype") == "compact_boundary"]
    queued = tool_results(rows, "compact_after_turn")
    slug_dirs = [d for d in (Path.home() / ".claude" / "checkpoints").glob(f"*{re.sub(r'[^A-Za-z0-9]', '-', root.name + '/boundary')}") if d.is_dir()]
    checkpoints = [f.name for d in slug_dirs for f in d.glob("*.ckpt.md")]
    for d in slug_dirs:
        for f in list(d.glob("*.ckpt.md")) + list((d / "archive").glob("*.ckpt.md")):
            f.unlink()
        for sub in (d / "archive", d):
            if sub.is_dir() and not any(sub.iterdir()):
                sub.rmdir()
    return {
        "auto_save_started": bool(started),
        "auto_save_notice": (started or {}).get("text", "")[:170],
        "compaction_triggers": boundaries,
        "queue_calls": [("refused" if err else "queued") + ": " + text[:90] for err, text in queued],
        "checkpoints_written": checkpoints,
        "compacted_notice": (done or {}).get("text", "").splitlines()[0][:120] if done else "",
        "questions_asked": len(questions),
        "questions_verbatim_in_summary": verbatim_lines(questions, summary),
        "summary_chars": len(summary),
        "log": str(log),
    }


# ---------------------------------------------------------------- double

def run_double(claude: str, model: str, root: Path) -> dict:
    """A save, then a second queue call before its /compact runs: one compaction, not two."""
    fix = write_fixture(root)
    log = OUT / f"double-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    extra = ["--plugin-dir", str(REPO), "--permission-mode", "bypassPermissions"]
    s = Session(claude, Path("/"), model, log, extra, BASE_ENV)
    s.turn(
        f"We're working on the project at {fix}. Read the 'Next action' and 'Open questions' sections of {fix}/STATE.md "
        "(not the whole file). Standing rule from now on: never push without asking me. Then list the open decisions, "
        "numbered, each with your recommendation. Do not change any files."
    )
    s.mark("first save")
    s.send("/smart-compact:save")
    # The second queue call lands between the save's turn end and its /compact, as a
    # /smart-compact:save typed during an automatic save did on 2026-11-04 (a slash command
    # waits for the turn to end; plain text sent mid-turn joins the running turn instead).
    # Sent the moment the save turn ends: the plugin hands /compact over 100 ms later.
    # Asked for outright, since a plain second save is up to the model: Sonnet 5.5 and Opus 5.5
    # both declined it in tests (nothing new), while Opus 5.5 queued it in the real session.
    results = 1 if s.wait(lambda e: e.get("type") == "result", 600) else 0
    s.mark("second queue call, at the save turn's end")
    s.send(
        "Call mcp__smart-compact__compact_after_turn again now, with the same instructions and checkpoint as your save "
        "(load it with ToolSearch if needed). Then reply with only the tool's answer, verbatim."
    )
    results += 1 if s.wait(lambda e: e.get("type") == "result", 300) else 0
    is_done = lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and e.get("plugin") == "smart-compact" and "compacted" in e.get("text", "")
    first = s.wait(is_done, 420)
    # A second compaction, if the bug is there, follows the first within a minute or so.
    second = s.wait(is_done, 180) if first else None
    s.close()
    rows = read_log(log)
    boundaries = [(r.get("compact_metadata") or {}) for r in rows if r.get("subtype") == "compact_boundary"]
    queue = tool_results(rows, "compact_after_turn")
    result = {
        "turn_results": results,
        "compactions": len(boundaries),
        "boundary_metadata": [{k: v for k, v in b.items() if "token" in k.lower() or k == "trigger"} for b in boundaries],
        "queue_calls": [("refused" if err else "answered") + ": " + text[:150] for err, text in queue],
        "compacted_notices": [n["text"].splitlines()[0][:120] for n in (first, second) if n],
        "checkpoints": [c.name for c in checkpoints_for(fix)],
        "log": str(log),
    }
    cleanup(fix)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=["auto", "saves", "boundary", "double", "both", "all"], default="all")
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--claude")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    claude = find_claude(args.claude)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if args.scenario in ("saves", "both", "all"):
            print(json.dumps({"saves": run_saves(claude, args.model, root)}, indent=1), flush=True)
        if args.scenario in ("double", "all"):
            print(json.dumps({"double": run_double(claude, args.model, root)}, indent=1), flush=True)
        if args.scenario in ("boundary", "all"):
            print(json.dumps({"boundary": run_boundary(claude, args.model, root)}, indent=1), flush=True)
        if args.scenario in ("auto", "both", "all"):
            for contract in (True, False):
                print(json.dumps({"auto": run_auto_arm(claude, args.model, contract, root)}, indent=1), flush=True)


if __name__ == "__main__":
    main()
