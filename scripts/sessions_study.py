"""What compaction does to long Claude Code sessions: a reproducible measurement over your own transcripts.

Reads ~/.claude/projects/*/*.jsonl (Claude Code's session transcripts) and reports aggregates only:
- interactive sessions (scripted -p / SDK test sessions excluded) and their compactions, by trigger, de-duplicated
  across resumed and forked transcripts by the compaction row's uuid;
- what preceded each compaction: minutes and tool calls since the user's last message (an automatic compaction that
  fires on the user's next message shows 0 and 0);
- approvals: how often "go with recs" (typed or clicked) answers a numbered list that asks something;
- loss candidates: user messages within the next 5 after a compaction that restate or point back ("as I said",
  "you forgot", "I already told you", "earlier question"...). These are candidates for review, not confirmed losses:
  the pattern also matches ordinary references to earlier work.

Usage:  python3 scripts/sessions_study.py [--days 60] [--json out.json] [--examples]
--examples prints the matched candidate lines locally (they are your own messages; nothing is written elsewhere).
Standard library only.
"""

import argparse
import json
import re
import time
from collections import Counter
from pathlib import Path

NUMBERED = re.compile(r"^\s*(?:\*\*)?\d{1,2}[.)]", re.M)
ASKS = re.compile(r"\?|\brec(?:s|ommend\w*)?\b", re.I)
GO_WITH_RECS = re.compile(r"\bgo with (?:the |your |my )?rec(?:s|ommendations?)\b", re.I)
APPROVAL = re.compile(r"^\s*(?:go with (?:the |your )?recs?\b|continue\b|yes\b|yep\b|ok(?:ay)?\b|do it\b|ship it\b|merge\b|approved?\b|sounds good\b|lgtm\b|go ahead\b|proceed\b)", re.I)
POINTS_BACK = re.compile(
    r"\b(as i (?:said|mentioned|told you)|i (?:already|just) (?:said|told you|asked)|you forgot|did you forget|remember (?:that|when|my)|"
    r"(?:my|the) earlier (?:question|request|message)|address my (?:earlier|previous)|like i said|we (?:already )?(?:decided|agreed)|"
    r"i told you|again,? (?:please|i)|you (?:were|are) supposed to|that'?s not what i)\b",
    re.I,
)


def text_of(row: dict) -> str:
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def tool_uses(row: dict) -> int:
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    content = message.get("content")
    return sum(1 for b in content or [] if isinstance(b, dict) and b.get("type") == "tool_use") if isinstance(content, list) else 0


def is_user_message(row: dict) -> bool:
    if row.get("type") != "user" or row.get("isMeta") or row.get("isCompactSummary"):
        return False
    t = text_of(row).strip()
    return bool(t) and not t.startswith("<") and not t.startswith("Base directory for this skill") and not t.startswith("This session is being continued")


def asks_numbered(text: str) -> bool:
    return len(NUMBERED.findall(text)) >= 2 and bool(ASKS.search(text))


def ts(row: dict) -> float | None:
    t = row.get("timestamp")
    if not isinstance(t, str):
        return None
    try:
        return time.mktime(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return None


def study(days: int, show_examples: bool) -> dict:
    cutoff = time.time() - days * 86400
    files = [f for f in (Path.home() / ".claude" / "projects").glob("*/*.jsonl") if f.stat().st_mtime >= cutoff]
    sessions, seen_compactions, continued = set(), set(), set()
    compactions: list[dict] = []
    user_messages = approvals = 0
    gwr = gwr_answering_list = 0
    other = other_answering_list = 0
    phrasings: Counter = Counter()
    candidates: list[str] = []
    for f in files:
        rows = []
        for line in f.read_text(errors="ignore").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        # Interactive sessions only. The entrypoint can't tell: a `claude -p` run started from inside a desktop
        # session inherits "claude-desktop". App sessions get a title row; scripted runs don't, and test
        # harnesses run in temporary folders.
        titled = any(r.get("type") in ("custom-title", "ai-title", "agent-name") for r in rows)
        cwd = next((r.get("cwd") for r in rows if r.get("cwd")), "") or ""
        if not titled or "/var/folders/" in cwd or cwd.startswith(("/private/var/", "/tmp/")):
            continue
        users = [i for i, r in enumerate(rows) if is_user_message(r)]
        if len(users) < 3:
            continue
        sessions.add(f.stem)
        if text_of(rows[users[0]]).startswith("This session is being continued"):
            continued.add(f.stem)
        last_assistant = ""
        for i, r in enumerate(rows):
            if r.get("type") == "assistant" and text_of(r).strip():
                last_assistant = text_of(r)
            if not is_user_message(r):
                continue
            t = text_of(r).strip()
            user_messages += 1
            if APPROVAL.match(t):
                approvals += 1
                phrasings[re.sub(r"\s+", " ", t.lower())[:40]] += 1
            if GO_WITH_RECS.search(t):
                gwr += 1
                gwr_answering_list += asks_numbered(last_assistant)
            else:
                other += 1
                other_answering_list += asks_numbered(last_assistant)
        for i, r in enumerate(rows):
            if r.get("subtype") != "compact_boundary":
                continue
            key = r.get("uuid") or f"{f.stem}:{i}"
            if key in seen_compactions:
                continue
            seen_compactions.add(key)
            meta = r.get("compactMetadata") or {}
            before = [j for j in users if j < i]
            last_user = before[-1] if before else None
            calls = sum(tool_uses(rows[j]) for j in range(last_user, i)) if last_user is not None else None
            minutes = None
            if last_user is not None and ts(rows[last_user]) and ts(r):
                minutes = round((ts(r) - ts(rows[last_user])) / 60, 1)
            after = [j for j in users if j > i][:5]
            flagged = [text_of(rows[j]).strip() for j in after if POINTS_BACK.search(text_of(rows[j]))]
            if flagged:
                candidates.extend(flagged[:1])
            compactions.append({"trigger": meta.get("trigger"), "pre_tokens": meta.get("preTokens"), "precomputed": bool(meta.get("precomputed")),
                                "tool_calls_since_user": calls, "minutes_since_user": minutes, "loss_candidate": bool(flagged)})
    auto = [c for c in compactions if c["trigger"] == "auto"]
    on_next_message = [c for c in auto if c["tool_calls_since_user"] == 0 and (c["minutes_since_user"] or 0) <= 1]
    result = {
        "window_days": days,
        "interactive_sessions": len(sessions),
        "of_which_continuations": len(continued),
        "compactions": len(compactions),
        "by_trigger": dict(Counter(c["trigger"] for c in compactions)),
        "auto_precomputed": sum(c["precomputed"] for c in auto),
        "auto_on_users_next_message": len(on_next_message),
        "auto_pre_tokens_median": sorted(c["pre_tokens"] for c in auto if c["pre_tokens"])[len(auto) // 2] if auto else None,
        "user_messages": user_messages,
        "approval_share": round(approvals / user_messages, 3) if user_messages else None,
        "go_with_recs": gwr,
        "go_with_recs_answering_numbered_list": round(gwr_answering_list / gwr, 3) if gwr else None,
        "other_messages_after_numbered_list": round(other_answering_list / other, 3) if other else None,
        "compactions_with_loss_candidate": sum(c["loss_candidate"] for c in compactions),
        "loss_candidates_after_auto": sum(c["loss_candidate"] for c in auto),
        "top_approval_phrasings": phrasings.most_common(6),
    }
    if show_examples:
        result["candidate_examples_local_only"] = [c[:160] for c in candidates]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--json")
    parser.add_argument("--examples", action="store_true")
    args = parser.parse_args()
    result = study(args.days, args.examples)
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
