"""Drive a Claude Code session the way the desktop app does: stream-json in and out,
one message per turn, stdin held open so queued commands (like the plugin's
/compact) get an idle session to run in. Standard library only."""

import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path


def find_claude(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("claude")
    if not found:
        raise SystemExit("claude CLI not found: pass --claude /path/to/claude")
    return found


def context_tokens(usage: dict) -> int:
    """Input tokens a request was answered over: uncached + cache-written + cache-read."""
    return usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_read_input_tokens", 0)


class Session:
    def __init__(self, claude: str, cwd: Path, model: str, log_path: Path, extra: list[str], env: dict[str, str] | None = None):
        args = [claude, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", model, *extra]
        full_env = {**os.environ, **(env or {})}
        self.proc = subprocess.Popen(args, cwd=cwd, env=full_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.events: queue.Queue = queue.Queue()
        self.log = open(log_path, "w")
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self.log.write(line)
            self.log.flush()
            try:
                self.events.put(json.loads(line))
            except json.JSONDecodeError:
                pass
        self.events.put(None)

    def mark(self, label: str) -> None:
        self.log.write(json.dumps({"type": "driver_mark", "label": label}) + "\n")
        self.log.flush()

    def send(self, text: str) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
        self.proc.stdin.flush()

    def wait(self, predicate, timeout: float) -> dict | None:
        end = time.time() + timeout
        while time.time() < end:
            try:
                event = self.events.get(timeout=1)
            except queue.Empty:
                continue
            if event is None:
                return None
            if predicate(event):
                return event
        return None

    def turn(self, text: str, timeout: float = 420) -> dict | None:
        self.send(text)
        return self.wait(lambda e: e.get("type") == "result", timeout)

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()


def read_log(path: Path) -> list[dict]:
    rows = []
    for line in open(path):
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def requests(rows: list[dict]) -> list[dict]:
    """One entry per model request: its context size, segment label, and tool calls."""
    out: list[dict] = []
    seen: dict[str, dict] = {}
    label = ""
    for row in rows:
        if row.get("type") == "driver_mark":
            label = row["label"]
            continue
        if row.get("type") != "assistant":
            continue
        message = row["message"]
        entry = seen.get(message["id"])
        if entry is None:
            entry = {"label": label, "context": context_tokens(message.get("usage", {})), "tools": []}
            seen[message["id"]] = entry
            out.append(entry)
        for block in message.get("content", []):
            if block.get("type") == "tool_use":
                entry["tools"].append((block["name"], block.get("input", {})))
    return out
