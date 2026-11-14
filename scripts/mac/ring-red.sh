#!/usr/bin/env bash
# One pass of scripts/ring-red.ts (#4491) on the office Mac, every 10 minutes from launchd
# (scripts/mac/dev.rustybuns.ring-red.plist): a red hourly ring gets bisected on Bob and, 60 minutes on, reverted.
# It runs from its own clone of main in ~/.rustybuns/ring-red/src, so no worktree is touched, and logs to
# ~/.rustybuns/ring-red/log. This Mac needs gh signed in, BUILDER_HOST in ~/.zshenv (launchd reads no other profile)
# and office-workers on PATH.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
[ -f "$HOME/.zshenv" ] && BUILDER_HOST="$(zsh -c 'source ~/.zshenv >/dev/null 2>&1; print -r -- "${BUILDER_HOST:-}"')" && export BUILDER_HOST
home="$HOME/.rustybuns/ring-red"
mkdir -p "$home"; cd "$home"
mkdir "$home/lock" 2> /dev/null || exit 0 # a bisect on Bob can outlast 10 minutes
trap 'rmdir "$home/lock"' EXIT
exec >> "$home/log" 2>&1
echo "== $(date '+%F %T')"
[ -d src ] || git clone -q https://github.com/QuinnsCode/RustyBuns src
git -C src fetch -q origin main && git -C src checkout -q --detach FETCH_HEAD
cd src && GITHUB_REPOSITORY=QuinnsCode/RustyBuns bun scripts/ring-red.ts
