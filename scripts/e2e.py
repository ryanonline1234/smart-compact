"""End-to-end check of the whole flow on a real model, in a throwaway project:

    1. read three generated files      (fills context)
    2. /smart-compact:save             (checkpoint + automatic compaction)
    3. /smart-compact:rehydrate        (the opt-in rebuild)

Then prints the plugin's notice next to what actually happened: the compaction
record, which files compaction re-attached, what rehydrate read, and how much
context rehydrate added. Uses this repo as the plugin (--plugin-dir).

Usage:
    python3 scripts/e2e.py [--model claude-sonnet-5-5] [--claude PATH]
Takes about two minutes and costs well under a dollar. The run uses
--permission-mode bypassPermissions inside its temporary project.
"""

import argparse
import glob
import json
import os
import random
import tempfile
import time
from pathlib import Path

from session import Session, find_claude, read_log, requests

REPO = Path(__file__).resolve().parent.parent


def write_fixture(root: Path) -> None:
    random.seed(7)
    words = ["token", "session", "user", "refresh", "expiry", "claims", "issuer", "scope", "nonce", "audience"]
    (root / "src").mkdir()
    (root / "docs").mkdir()
    code = ["import { createHash } from 'node:crypto'", ""]
    for i in range(60):
        a, b = random.sample(words, 2)
        code += [
            f"export function {a}{b.capitalize()}{i}(input: string, opts: {{ ttl?: number }} = {{}}): string {{",
            f"  const {a} = createHash('sha256').update(input + '{b}').digest('hex')",
            f"  if ((opts.ttl ?? 0) > {i * 7}) return {a}.slice(0, {8 + i % 16})",
            f"  return `${{{a}}}:{b}:{i}`",
            "}",
            "",
        ]
    (root / "src/auth.ts").write_text("\n".join(code))
    notes = ["# Notes", ""] + [
        f"- Case {i}: the {random.choice(words)} check compares seconds with milliseconds, "
        f"so a {random.choice(words)} expires early when clocks drift." for i in range(70)
    ]
    (root / "docs/NOTES.md").write_text("\n".join(notes))
    small = ["# Plan", "", "1. Find the unit mismatch.", "2. Patch the comparison.", "3. Add a skewed-clock test."]
    (root / "docs/PLAN.md").write_text("\n".join(small))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--claude")
    args = parser.parse_args()

    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    log = out / f"e2e-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        write_fixture(root)
        extra = ["--permission-mode", "bypassPermissions", "--plugin-dir", str(REPO)]
        s = Session(find_claude(args.claude), root, args.model, log, extra)
        s.mark("read")
        print("1/3 reading files", flush=True)
        s.turn("Read src/auth.ts, docs/NOTES.md and docs/PLAN.md in full with the Read tool, then say in two sentences what the bug is. Do not edit anything.")
        s.mark("save")
        print("2/3 /smart-compact:save", flush=True)
        s.turn("/smart-compact:save")
        notice = s.wait(lambda e: e.get("type") == "system" and e.get("subtype") == "ui_log" and e.get("plugin") == "smart-compact", 240)
        s.wait(lambda e: e.get("type") == "result", 20)
        s.mark("rehydrate")
        print("3/3 /smart-compact:rehydrate", flush=True)
        s.turn("/smart-compact:rehydrate")
        s.close()

    rows = read_log(log)
    print("\n— plugin notice —")
    print(notice["text"] if notice else "(none: the compaction did not report)")
    boundary = next((r for r in rows if r.get("subtype") == "compact_boundary"), None)
    if boundary:
        meta = boundary["compact_metadata"]
        print(f"\n— compaction — trigger {meta['trigger']}, {meta['pre_tokens']} → {meta['post_tokens']} tokens (engine count)")
    session_id = next((r["session_id"] for r in rows if r.get("subtype") == "init"), None)
    transcripts = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session_id}.jsonl")) if session_id else []
    if transcripts:
        lines = open(transcripts[0]).read().splitlines()
        last = max(i for i, l in enumerate(lines) if '"compact_boundary"' in l)
        print("— re-attached by compaction —")
        for l in lines[last + 1:]:
            row = json.loads(l)
            a = row.get("attachment") or {}
            if a.get("type") in ("file", "compact_file_reference"):
                print(f"  {'full' if a['type'] == 'file' else 'path only'}: {Path(a['filename']).name}")
    reqs = [r for r in requests(rows) if r["label"] == "rehydrate"]
    if len(reqs) >= 2:
        reads = [Path(i.get("file_path", "?")).name + (f":{i['offset']}+{i['limit']}" if "offset" in i else "") for r in reqs for n, i in r["tools"] if n == "Read"]
        print(f"\n— rehydrate — read {', '.join(reads) or 'nothing'}")
        print(f"context grew {reqs[-1]['context'] - reqs[0]['context']} tokens across the turn (the model's own calls included)")
    print(f"\nraw stream: {log}")
    cleanup_checkpoints(notice["text"] if notice else "", root.name)


def cleanup_checkpoints(notice_text: str, temp_name: str) -> None:
    """Remove the checkpoint folder this run's throwaway project created, and nothing else."""
    base = Path.home() / ".claude" / "checkpoints"
    for folder in base.glob(f"*{temp_name}"):
        if not folder.is_dir() or temp_name not in folder.name:
            continue
        for f in list(folder.glob("*.ckpt.md")) + list((folder / "archive").glob("*.ckpt.md")):
            f.unlink()
        for d in (folder / "archive", folder):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()


if __name__ == "__main__":
    main()
