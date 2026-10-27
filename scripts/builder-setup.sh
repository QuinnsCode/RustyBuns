#!/bin/sh
# Make this Mac the build and test machine the agents drive over SSH (scripts/remote-ci.ts, #2329, #2330).
# Run it on the builder (the 64 GB MacBook Pro), from anywhere:
#
#   curl -fsSL https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/scripts/builder-setup.sh | sh -s -- 3
#
# The number is how many warm checkouts (slots) to keep, one per agent run at a time. Run it again any time:
# it only adds what is missing, pulls main, and times one suite. It never gets a secret: tests and builds only.
set -eu
SLOTS=${1:-3}
ROOT="$HOME/builder"
REPO=https://github.com/QuinnsCode/RustyBuns.git
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
say() { printf '\n== %s\n' "$*"; }

say "Remote Login (SSH)"
if nc -z -G 2 localhost 22 2>/dev/null; then echo "on"; else
  echo "off: System Settings > General > Sharing > Remote Login, turn it on, then run this again"
  exit 1
fi

say "Stay awake on power (asks for your password)"
sudo pmset -c sleep 0 disablesleep 1 && echo "on power it never sleeps, lid closed included"

say "Bun"
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
bun --version

say "Docker"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  gb=$(( $(docker info --format '{{.MemTotal}}') / 1073741824 ))
  echo "Docker has ${gb} GB"
  [ "$gb" -ge 40 ] || echo "raise it: Docker Desktop > Settings > Resources, memory about 48 GB, all CPUs, disk 120 GB+"
else
  echo "not running: tests don't need it, container builds do (Docker Desktop, then run this again)"
fi

say "$SLOTS slots in $ROOT"
mkdir -p "$ROOT/locks"
i=1
while [ "$i" -le "$SLOTS" ]; do
  d="$ROOT/slot-$i"
  [ -d "$d/.git" ] || git clone -q "$REPO" "$d"
  if [ ! -d "$ROOT/locks/slot-$i" ]; then
    (cd "$d" && git fetch -q origin main && git checkout -q -f --detach FETCH_HEAD && bun install --frozen-lockfile --silent)
  fi
  echo "slot-$i at $(git -C "$d" log -1 --format='%h %s')"
  i=$((i + 1))
done

say "One timing: codesplitter's suite on slot-1"
start=$(date +%s)
(cd "$ROOT/slot-1/apps/codesplitter" && bun test --parallel test >/dev/null 2>&1) && r=passed || r=failed
echo "$r in $(( $(date +%s) - start ))s on $(sysctl -n hw.ncpu) cores, $(( $(sysctl -n hw.memsize) / 1073741824 )) GB"

say "Last step, on the office Mac"
name="$(whoami)@$(scutil --get LocalHostName).local"
echo "1. ssh-copy-id $name        (once, so agents get in without a password)"
echo "2. echo 'export BUILDER_HOST=$name' >> ~/.zshenv   then restart the office"
echo "3. bun run builder run scripts bun test ./ci-tier.test.ts   (from a RustyBuns checkout, to check)"
