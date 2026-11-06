"""Was anything lost at each compaction? A rubric judged by clean headless sessions, one per compaction.

For every compaction in your interactive sessions (the same population as sessions_study.py), the judge reads:
  BEFORE   the user's and assistant's messages since the previous compaction (capped),
  SUMMARY  the compaction summary,
  AFTER    the next turns after the compaction (capped),
and answers with a fixed rubric: did the session lose something it had established before, as shown by what
happened after? Categories: standing rule, pending decision or question, task state or plan, working method, other.
A loss needs evidence in AFTER (the assistant breaks or forgets it, or the user has to restate it).

The judge runs as `claude -p --safe-mode --tools "" --strict-mcp-config --disable-slash-commands` from a scratch
folder: no memory, no CLAUDE.md, no plugins, no tools. Results stay local (default ~/smart-compact-runs/losses/).

Usage:  python3 scripts/loss_judge.py --claude PATH [--days 60] [--model claude-opus-5-5] [--parallel 4] [--limit N]
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

from sessions_study import is_user_message, text_of

CAP_CARRIED, CAP_TAIL, CAP_AFTER, CAP_MSG = 12_000, 16_000, 10_000, 1_800

RUBRIC = """You are auditing one context compaction in a Claude Code session. Before the compaction, the conversation established things; the compaction replaced that conversation with the SUMMARY; AFTER shows what happened next.

Decide whether the session LOST something it had established BEFORE, judged by what happens AFTER: the assistant breaks or ignores a standing rule, mishandles or forgets a pending decision or question (for example a "go with recs" that no longer resolves to the right list), acts on a stale plan or task state, loses a working method it had, or the user has to restate something already said. Something missing from the SUMMARY alone is not a loss unless AFTER shows its absence mattered. If AFTER is too short to tell, answer lost=false with confidence low.

=== BEFORE (since the previous compaction, newest last; may be truncated at the start) ===
{before}

=== SUMMARY ===
{summary}

=== AFTER ===
{after}

Answer with only a JSON object:
{{"lost": true|false, "category": "standing_rule|pending_decision|task_state|method|other|none", "what": "one sentence", "evidence_before": "short quote", "evidence_after": "short quote", "confidence": "high|medium|low"}}"""


def session_rows(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(errors="ignore").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def interactive(rows: list[dict]) -> bool:
    titled = any(r.get("type") in ("custom-title", "ai-title", "agent-name") for r in rows)
    cwd = next((r.get("cwd") for r in rows if r.get("cwd")), "") or ""
    return titled and "/var/folders/" not in cwd and not cwd.startswith(("/private/var/", "/tmp/")) and sum(is_user_message(r) for r in rows) >= 3


def line_of(row: dict) -> str | None:
    if is_user_message(row):
        return f"USER: {text_of(row).strip()[:CAP_MSG]}"
    if row.get("type") == "assistant":
        t = text_of(row).strip()
        return f"ASSISTANT: {t[:CAP_MSG]}" if t else None
    return None


def cases(days: int) -> list[dict]:
    cutoff = time.time() - days * 86400
    seen, out = set(), []
    for f in (Path.home() / ".claude" / "projects").glob("*/*.jsonl"):
        if f.stat().st_mtime < cutoff:
            continue
        rows = session_rows(f)
        if not interactive(rows):
            continue
        bounds = [i for i, r in enumerate(rows) if r.get("subtype") == "compact_boundary"]
        for n, b in enumerate(bounds):
            key = rows[b].get("uuid") or f"{f.stem}:{b}"
            if key in seen:
                continue
            seen.add(key)
            start = bounds[n - 1] if n > 0 else 0
            # v2 (2026-11-05): what the session carried into this stretch (the previous summary), every user message
            # since (small: median 413 chars), and the conversation's last stretch. v1 gave only the last 24k
            # characters, which hid rules stated in earlier stretches.
            carried = next((text_of(r) for r in rows[start:start + 6] if r.get("isCompactSummary")), "") if n > 0 else ""
            said = [f"USER: {text_of(r).strip()[:1200]}" for r in rows[start:b] if is_user_message(r)]
            before = [l for l in (line_of(r) for r in rows[start:b]) if l]
            summary = next((text_of(r) for r in rows[b:b + 6] if r.get("isCompactSummary")), "")
            end = bounds[n + 1] if n + 1 < len(bounds) else len(rows)
            after = [l for l in (line_of(r) for r in rows[b + 1:end]) if l and not l.startswith("USER: This session is being continued")][:12]
            tail = "\n\n".join(before)
            tail = "…" + tail[-CAP_TAIL:] if len(tail) > CAP_TAIL else tail
            b_text = "\n\n".join(part for part in (
                f"-- What the session carried into this stretch (the previous compaction's summary) --\n{carried[:CAP_CARRIED]}" if carried else "",
                "-- Everything the user said in this stretch, in order --\n" + "\n\n".join(said),
                f"-- The conversation's last stretch before the compaction --\n{tail}",
            ) if part)
            out.append({
                "id": key, "session": f.stem, "trigger": (rows[b].get("compactMetadata") or {}).get("trigger"),
                "before": b_text, "summary": summary[:12_000], "after": "\n\n".join(after)[:CAP_AFTER], "after_turns": len(after),
            })
    return out


def judge(claude: str, model: str, case: dict) -> dict:
    prompt = RUBRIC.format(before=case["before"] or "(nothing)", summary=case["summary"] or "(none recorded)", after=case["after"] or "(nothing)")
    with tempfile.TemporaryDirectory() as scratch:
        r = subprocess.run([claude, "-p", "--safe-mode", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--model", model, "--output-format", "json"],
                           input=prompt, cwd=scratch, env={**os.environ, "CLAUDE_CODE_PLUGIN_DIRS": "/nonexistent"}, capture_output=True, text=True, timeout=900)
    try:
        text = json.loads(r.stdout).get("result", "")
        return json.loads(re.search(r"\{[\s\S]*\}", text).group(0))
    except Exception as err:  # noqa: BLE001 — record, don't stop the batch
        return {"error": f"{err}: {r.stdout[:160]} {r.stderr[:160]}"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--claude", required=True)
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--model", default="claude-opus-5-5")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--out", default=str(Path.home() / "smart-compact-runs" / "losses"))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    todo = cases(args.days)[: args.limit]
    print(f"{len(todo)} compactions to judge", flush=True)
    results: list[dict] = []
    lock = threading.Lock()
    queue = list(todo)

    def worker() -> None:
        while True:
            with lock:
                if not queue:
                    return
                case = queue.pop(0)
            verdict = judge(args.claude, args.model, case)
            row = {"id": case["id"], "session": case["session"], "trigger": case["trigger"], "after_turns": case["after_turns"], **verdict}
            with lock:
                results.append(row)
                (out / "verdicts.jsonl").open("a").write(json.dumps(row) + "\n")
                print(f"[{len(results)}/{len(todo)}] {case['trigger']} lost={verdict.get('lost')} {verdict.get('category')} ({verdict.get('confidence')})", flush=True)

    threads = [threading.Thread(target=worker) for _ in range(args.parallel)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    judged = [r for r in results if "error" not in r]
    tally = {
        "compactions": len(todo), "judged": len(judged), "errors": len(results) - len(judged),
        "lost": sum(1 for r in judged if r.get("lost")),
        "lost_high_or_medium": sum(1 for r in judged if r.get("lost") and r.get("confidence") in ("high", "medium")),
        "lost_after_auto": sum(1 for r in judged if r.get("lost") and r.get("trigger") == "auto"),
        "auto": sum(1 for r in judged if r.get("trigger") == "auto"),
        "by_category": {c: sum(1 for r in judged if r.get("lost") and r.get("category") == c) for c in ("standing_rule", "pending_decision", "task_state", "method", "other")},
    }
    (out / "tally.json").write_text(json.dumps(tally, indent=1))
    print(json.dumps(tally, indent=1))


if __name__ == "__main__":
    main()
