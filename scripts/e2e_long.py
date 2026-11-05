"""Long-horizon end-to-end checks on a real model, in throwaway folders.

  auto   Does the summary contract reach the engine's OWN compaction? Two arms,
         contract on and off: state two standing rules, get three numbered
         questions with recommendations, then read files until Claude Code
         auto-compacts (window forced to 100k). Compare what each summary kept.
  saves  Two saves in one session started at "/", as the desktop app runs:
         project-root keying, carry-forward of rules and open decisions, an
         approval with a condition, and section targets in the manifest.
  double  A second queue call sent while a save is still running (as when the
         user types /smart-compact:save during an automatic save): the
         session should compact once, not twice.
  ab     The quality gate for checkpoints at Claude Code's own compactions: the
         same scripted session twice, one arm saving by hand near the point,
         the other letting Claude Code compact and the plugin's fork write the
         checkpoint. Both are graded on the same rubric; --runs N pairs.

Usage:
    python3 scripts/e2e_long.py [--scenario auto|saves|double|ab|all] [--runs N] [--model claude-sonnet-5-5] [--claude PATH]
Costs a few dollars and takes about ten minutes for both. Uses this repo as the
plugin (--plugin-dir) and hides other plugin folders (CLAUDE_CODE_PLUGIN_DIRS).
"""

import argparse
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from session import Session, find_claude, read_log, requests

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


# ---------------------------------------------------------------- ab

NOTE = "The refresh window should be computed from the server clock, not the client clock, because mobile clients drift by minutes. "
QUESTION = re.compile(r"^\s*\**\d\.\s.*\?.*Rec", re.I)


def section(md: str, title: str) -> str:
    """The text under the first heading that contains title, to the next heading of its level or higher."""
    lines = md.split("\n")
    start, level = -1, 0
    for i, line in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if not m:
            continue
        if start == -1:
            if title in m.group(2).lower():
                start, level = i, len(m.group(1))
        elif len(m.group(1)) <= level:
            return "\n".join(lines[start + 1:i])
    return "\n".join(lines[start + 1:]) if start != -1 else ""


def manifest_targets(md: str) -> list[str]:
    out = []
    for line in section(md, "rehydration manifest").split("\n"):
        cells = [c.strip() for c in line.split("|")]
        if len(cells) > 4 and cells[1].isdigit() and cells[2].lower() == "read":
            out.append(cells[3].strip("`"))
    return out


def target_exists(target: str, root: Path) -> bool:
    path = re.split(r"[#:]", target, maxsplit=1)[0].strip()
    p = Path(path).expanduser()
    return (p if p.is_absolute() else root / p).exists()


STOP = {"the", "and", "for", "with", "that", "this", "from", "are", "was", "not", "but", "you", "all", "any", "its", "has", "have", "into", "than", "then", "when", "what", "will", "can", "only", "options", "option", "rec", "recs", "recommendation", "stated", "scope"}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9$']+", text.lower()) if len(w) >= 3 and w not in STOP}


def carried(item: str, later: str) -> bool:
    """As the plugin's own check (ledger.ts isCarried): most of the item's words in one block, or a settled line naming its question."""
    bare = re.sub(r"\([^)]*\)", " ", re.sub(r"^\s*\d\.\s*", "", item))
    want = _words(bare)
    name = _words(re.split(r"(?<=[?.!])\s", bare, maxsplit=1)[0])
    share = lambda a, b: 1.0 if not a else len(a & b) / len(a)
    for block in re.split(r"\n(?=\s*(?:[-*]|\d+\.)\s)", later):
        have = _words(block)
        if share(want, have) >= 0.6:
            return True
        if re.match(r"^\s*[-*]?\s*(?:~~|\*\*)?\s*(retired|answered|done|superseded|promoted)\b", block, re.I) and share(name, have) >= 0.6:
            return True
    return False


def grade(p0: str, p1: str, fix: Path, questions: list[str]) -> dict:
    """The rubric, from the measured loss types: rules, open decisions verbatim, approvals with conditions, carry-forward, task state, manifest, links."""
    s1, s2, s3 = section(p1, "standing rules"), section(p1, "open decisions"), section(p1, "task state")
    p0_open = [l for l in section(p0, "open decisions").split("\n") if re.match(r"^\s*\d\.", l)]
    targets = manifest_targets(p1)
    fm = lambda k: (re.search(rf"^{k}:\s*(.+)$", p1, re.M) or [None, ""])[1].strip()
    return {
        "rules_of_3": sum(words_hit(r, s1, 3) for r in ("you test your own work", "never push without asking", "keep commits small")),
        "new_questions_verbatim_of_3": verbatim_lines(questions, s2),
        "new_questions_present_of_3": sum(words_hit(q, s2, 5) for q in questions),
        "approval_with_condition": int(bool(re.search(r"answered[^\n]*(scrape|price pages)", s2, re.I) or re.search(r"scrape[^\n]*price", s2, re.I))),
        "previous_decisions_carried": sum(carried(q, p1) for q in p0_open),
        "task_state_has_the_edit": int(bool(re.search(r"csv and json|handoff/05", s3, re.I))),
        "manifest_targets_exist": int(len(targets) >= 2 and all(target_exists(t, fix) for t in targets)),
        "links_previous": int(bool(fm("previous")) and fm("previous").endswith(".ckpt.md") and fm("previous") != "none"),
        "next_action_filled": int(bool(fm("next_action")) and not fm("next_action").startswith("<") and fm("next_action") != "see §3"),
    }


def run_ab_arm(claude: str, model: str, root: Path, arm: str, out: dict) -> None:
    fix = write_fixture(root)
    (fix / "notes").mkdir()
    for i in range(1, 11):
        (fix / "notes" / f"notes-{i}.md").write_text("\n".join(f"Note {i}.{j}: {NOTE * 3}" for j in range(90)))
    log = OUT / f"ab-{arm}-{root.name}-{time.strftime('%H%M%S')}.jsonl"
    env = {**BASE_ENV, "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "150000"}
    extra = ["--plugin-dir", str(REPO), "--permission-mode", "bypassPermissions",
             "--settings", json.dumps({"pluginConfigs": {"smart-compact@inline": {"options": {"suggestAt": -1}}}})]
    s = Session(claude, Path("/"), model, log, extra, env)
    notice = lambda part: (lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and part in e.get("text", ""))
    boundary = lambda: [r for r in read_log(log) if r.get("subtype") == "compact_boundary"]
    s.turn(
        f"We're working on the project at {fix}. Read the 'Next action' and 'Open questions' sections of {fix}/STATE.md (not the whole file). "
        "Standing rules from now on: you test your own work; never push without asking me. Then list the open decisions, numbered, each with your recommendation. Do not change any files."
    )
    s.mark("first save")
    s.turn("/smart-compact:save")
    s.wait(notice("compacted"), 300)
    s.wait(lambda e: e.get("type") == "result", 30)
    s.mark("work")
    s.turn(
        "Go with recs on 1 and 3, but on 2 scrape the price pages instead. New rule from now on: keep commits small. "
        f"Now, with the Edit tool, add the line 'Export check covers CSV and JSON.' under '## 1. Built' in {fix}/HANDOFF/05_EXPORT_CHECK.md. Then reply only: done."
    )
    s.turn("Ask me exactly three numbered questions about the parts-cost check (HANDOFF/06), each followed by your recommendation, in the form 'N. <question>? Rec: <recommendation>.' Do not read any files yet.")
    asked = next((t for t in reversed(assistant_texts(read_log(log))) if len([l for l in t.split("\n") if QUESTION.match(l)]) >= 3), "")
    questions = [l.strip() for l in asked.split("\n") if QUESTION.match(l)][:3]
    s.mark("fill")
    first_compactions = len(boundary())
    status = "no compaction"
    for i in range(1, 11):
        s.turn(f"Read {fix}/notes/notes-{i}.md in full with the Read tool, then reply only with: read {i}.")
        if len(boundary()) > first_compactions:
            if arm == "manual":
                status = "invalid: Claude Code compacted before the manual save"
            else:
                done = s.wait(notice("a checkpoint for it was"), 420)
                status = "fork checkpoint" if done else "engine compacted, no checkpoint notice"
            break
        reqs = requests(read_log(log))
        if arm == "manual" and reqs and reqs[-1]["context"] >= 88_000:
            s.mark("second save")
            s.turn("/smart-compact:save")
            s.wait(notice("compacted"), 300)
            status = "manual checkpoint"
            break
    time.sleep(3)
    s.close()
    cps = checkpoints_for(fix)
    texts = [c.read_text() for c in cps]
    out[arm] = {
        "status": status,
        "checkpoints": [c.name for c in cps],
        "questions": questions,
        "grade": grade(texts[0], texts[-1], fix, questions) if len(texts) >= 2 else None,
        "written_by": (re.search(r"^written_by:\s*(.+)$", texts[-1], re.M) or [None, "manual save"])[1] if texts else None,
        "compactions": [(r.get("compact_metadata") or {}).get("trigger") for r in read_log(log) if r.get("subtype") == "compact_boundary"],
        "log": str(log),
    }
    keep = OUT / "ab-checkpoints" / root.name / arm
    keep.mkdir(parents=True, exist_ok=True)
    for c in cps:
        (keep / c.name).write_text(c.read_text())
    cleanup(fix)


def run_ab(claude: str, model: str, root: Path, runs: int) -> dict:
    pairs = []
    for n in range(1, runs + 1):
        out: dict = {}
        threads = [threading.Thread(target=run_ab_arm, args=(claude, model, root / f"ab{n}-{arm}", arm, out)) for arm in ("manual", "fork")]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        a, b = (out.get("manual") or {}).get("grade"), (out.get("fork") or {}).get("grade")
        verdict = None if not a or not b else {k: ("pass" if b[k] >= a[k] else "FAIL") for k in a}
        pairs.append({"run": n, "manual": out.get("manual"), "fork": out.get("fork"), "fork_vs_manual": verdict})
        print(json.dumps(pairs[-1], indent=1), flush=True)
    passed = sum(1 for p in pairs if p["fork_vs_manual"] and all(v == "pass" for v in p["fork_vs_manual"].values()))
    return {"pairs_passed": f"{passed} of {runs}", "gate": "pass" if passed == runs else "FAIL"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=["auto", "saves", "double", "ab", "both", "all"], default="all")
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--claude")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    claude = find_claude(args.claude)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if args.scenario in ("saves", "both", "all"):
            print(json.dumps({"saves": run_saves(claude, args.model, root)}, indent=1), flush=True)
        if args.scenario == "ab":
            print(json.dumps({"ab": run_ab(claude, args.model, root, args.runs)}, indent=1), flush=True)
        if args.scenario in ("double", "all"):
            print(json.dumps({"double": run_double(claude, args.model, root)}, indent=1), flush=True)
        if args.scenario in ("auto", "both", "all"):
            for contract in (True, False):
                print(json.dumps({"auto": run_auto_arm(claude, args.model, contract, root)}, indent=1), flush=True)


if __name__ == "__main__":
    main()
