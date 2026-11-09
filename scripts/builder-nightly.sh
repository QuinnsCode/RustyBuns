#!/bin/sh
# The builder's nightly desktop builds (#2496, #2500): launchd runs this twice a day
# (scripts/mac/dev.rustybuns.builder-nightly.plist, installed by builder-setup.sh). It keeps its own clone in
# ~/builder/nightly/src, apart from the test slots agents claim, pulls main, installs, and runs
# scripts/builder-nightly.ts, which writes ~/builder/nightly/results.json. Output goes to ~/builder/nightly/log.
# `bun run builder nightly` on the office Mac prints the failures.
#
# The whole body is one { } block, so sh reads all of it before `git pull` can rewrite this file under it.
{
set -eu
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
home="$HOME/builder/nightly"
mkdir -p "$home"
mkdir "$home/lock" 2>/dev/null || { echo "a nightly run is already going"; exit 0; }
trap 'rmdir "$home/lock"' EXIT
exec >> "$home/log" 2>&1
echo "== $(date '+%F %T')"

[ -d "$home/src/.git" ] || git clone -q https://github.com/QuinnsCode/RustyBuns.git "$home/src"
cd "$home/src"
git checkout -q main
git pull -q --ff-only origin main
bun install --frozen-lockfile --silent
bun scripts/builder-nightly.ts
exit
}
