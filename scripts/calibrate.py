"""Measure how many tokens the Read tool's output costs per file, on a real model.

Each file is read in a turn of its own; the cost is the context growth across
the read. Prints characters per token per file and the prose and code ratios
that fit them, in the model the plugin's estimate uses:

    tokens ≈ (chars + lines × (digits(lines) + 1)) / ratio

Usage:
    python3 scripts/calibrate.py FILE [FILE ...] [--model claude-sonnet-5-5] [--claude PATH]
Files ending in .md, .mdx, .markdown, .txt, .rst or .adoc count as prose.
Costs a few cents per file; the files are sent to the model.
"""

import argparse
import re
import shutil
import tempfile
import time
from pathlib import Path

from session import Session, find_claude, read_log, requests

PROSE = re.compile(r"\.(md|mdx|markdown|txt|rst|adoc)$", re.I)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--claude")
    args = parser.parse_args()

    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    log = out / f"calibrate-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    with tempfile.TemporaryDirectory() as tmp:
        names = []
        for f in args.files:
            target = Path(tmp) / f.name
            shutil.copy(f, target)
            names.append(f.name)
        s = Session(find_claude(args.claude), Path(tmp), args.model, log, ["--allowedTools", "Read"])
        s.turn("Reply with only: ready")
        for name in names:
            s.mark(name)
            s.turn(f"Use the Read tool once to read the whole file {name} (no offset or limit). After the result, reply with only: ok")
            print(f"read {name}", flush=True)
        s.close()

    by_label: dict[str, list[dict]] = {}
    for r in requests(read_log(log)):
        by_label.setdefault(r["label"], []).append(r)

    rows, sums = [], {"prose": [0, 0], "code": [0, 0]}
    print(f"\n{'file':28} {'chars':>7} {'lines':>6} {'tokens':>7} {'chars/token':>11}")
    for f, name in zip(args.files, names):
        reqs = by_label.get(name, [])
        if len(reqs) < 2:
            print(f"{name:28} (no measurement)")
            continue
        tokens = reqs[1]["context"] - reqs[0]["context"]
        text = f.read_text(errors="replace")
        chars, lines = len(text), text.count("\n") + 1
        kind = "prose" if PROSE.search(name) else "code"
        with_prefix = chars + lines * (len(str(lines)) + 1)
        sums[kind][0] += with_prefix
        sums[kind][1] += tokens
        rows.append((name, chars, lines, tokens))
        print(f"{name:28} {chars:7} {lines:6} {tokens:7} {chars / tokens:11.2f}")
    print()
    for kind, (c, t) in sums.items():
        if t:
            print(f"{kind} ratio (line-number prefix included): {c / t:.2f} chars/token")
    print(f"\nraw stream: {log}")


if __name__ == "__main__":
    main()
