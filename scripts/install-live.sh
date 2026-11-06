#!/usr/bin/env bash
# Refresh the author's live smart-compact install: a snapshot of one commit,
# outside this git checkout.
#
# Why: an interactive session hot-reloads the plugin folder it loads from, and
# a reload starts the hooks module over. Its timers go, and so does a fork
# that is writing a checkpoint. When the live install was this checkout, every
# commit, worktree or rebase (all of them write into .git) could do that to
# every open session (seen 2026-11-05).
#
# Usage: scripts/install-live.sh [ref]    (default: long-horizon)
# The snapshot goes to $SC_LIVE_DIR, default ~/.claude/smart-compact/plugin.
# CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json points there.
set -euo pipefail

REF="${1:-long-horizon}"
LIVE="${SC_LIVE_DIR:-$HOME/.claude/smart-compact/plugin}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Plain git fails on a Mac whose Xcode license is not accepted.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"

SHA="$(git -C "$REPO" rev-parse --short "$REF^{commit}")"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sc-live.XXXXXX")"
# Tracked files only, as committed: no .git, no scripts/out, no uncommitted edits.
git -C "$REPO" archive "$SHA" .claude-plugin hooks skills README.md LICENSE | tar -x -C "$TMP"
printf '%s %s %s\n' "$SHA" "$(git -C "$REPO" log -1 --format=%cI "$SHA")" "$REF" > "$TMP/.snapshot"

mkdir -p "$LIVE"
# Only files whose content changed are written, so an update is one reload, not one per file.
rsync -a --delete --checksum "$TMP/" "$LIVE/"
echo "live: $LIVE = $SHA ($REF), $(grep -o '"version": "[^"]*"' "$LIVE/.claude-plugin/plugin.json")"
