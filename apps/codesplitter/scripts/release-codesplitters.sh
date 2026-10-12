#!/bin/zsh
# Release codeSplitter to the live site: zsh ~/release-codesplitters.sh [--checks | --move]
# Run it from any folder. ~/release-codesplitters.sh is a copy of this file
# (apps/codesplitter/scripts/release-codesplitters.sh); copy it again only when this changes.
# It puts the release worktree on origin/main and hands over to scripts/release.ts there,
# which does the rest and is tested (test/release.test.ts), so a fix ships with main.
set -e
CLONE=$HOME/agent-office/QuinnsCode/RustyBuns
WT=$HOME/agent-office/QuinnsCode/RustyBuns-release
APP=apps/codesplitter
# bun, node, op and docker wherever they live, even if your terminal didn't load them.
export PATH=/opt/homebrew/bin:$HOME/.bun/bin:${$(print -l $HOME/.nvm/versions/node/*/bin(N) | tail -1):-/usr/bin}:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH
stop() { print -P "\n%F{red}✖ $1%f"; exit 1; }
for t in op bun git; do whence -p $t >/dev/null || stop "can't find $t on this Mac; tell Claude."; done
git -C $CLONE fetch -q origin || stop "git fetch failed; check your internet, then rerun."
[[ -d $WT ]] || git -C $CLONE worktree add -q --detach $WT origin/main || stop "couldn't make the release worktree; tell Claude."
# Plan and deploy rewrite these two from the config and the flags; anything else changed stops it.
git -C $WT checkout -q -- $APP/wrangler.jsonc $APP/.env.schema 2>/dev/null || true
git -C $WT checkout -q --detach origin/main || stop "the release worktree has local changes; tell Claude."
cd $WT
bun install >/dev/null 2>&1 || stop "bun install failed; tell Claude."
cd $APP
exec bun scripts/release.ts "$@"
