#!/bin/sh
# Make this Mac, or a Linux box (a cloud VM on Azure or anywhere), the build and test machine the agents drive
# over SSH (scripts/remote-ci.ts, #2329, #2330). The whole checklist, updates and installs first, is MAC_SETUP.md
# (Part 4, and "A Linux builder" under it). Run this on the builder, from anywhere:
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
MAC=; [ "$(uname -s)" = Darwin ] && MAC=1

if [ "$MAC" ]; then
  say "Remote Login (SSH)"
  if nc -z -G 2 localhost 22 2>/dev/null; then echo "on"; else
    echo "off: System Settings > General > Sharing > Remote Login, turn it on, then run this again"
    exit 1
  fi

  say "Stay awake on power (asks for your password)"
  sudo pmset -c sleep 0 disablesleep 1 && echo "on power it never sleeps, lid closed included"
else
  say "Tools Bun and the clones need"
  for t in git curl unzip; do command -v "$t" >/dev/null || { echo "missing $t: sudo apt-get install -y git curl unzip build-essential, then run this again"; exit 1; }; done
  echo "git, curl, unzip"
fi

say "Bun"
# 1.4.3 is the version CI pins: 1.4.4 panics in `bun install` on macOS 27 (#2500) and in rustybunsify compile (#2506).
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"
bun --version
case "$(bun --version)" in 1.4.3) ;; *) echo "not 1.4.3 (what CI pins): curl -fsSL https://bun.sh/install | bash -s \"bun-v1.4.3\"" ;; esac

say "Node (the framework examples need it)"
if command -v node >/dev/null; then node --version; else echo "missing: brew install node (or apt-get install nodejs), or the framework suites fail here"; fi

say "Rust (the apps with native code build with it)"
if command -v cargo >/dev/null; then cargo --version; else echo "missing: install it from rustup.rs, or those apps' suites fail here"; fi

say "Docker"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  gb=$(( $(docker info --format '{{.MemTotal}}') / 1073741824 ))
  echo "Docker has ${gb} GB"
  if [ "$MAC" ] && [ "$gb" -lt 40 ]; then echo "raise it: Docker Desktop > Settings > Resources, memory about 48 GB, all CPUs, disk 120 GB+"; fi
else
  echo "not running: tests don't need it, container builds do (Docker Desktop, or docker.io on Linux, then run this again)"
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
if [ "$MAC" ]; then cores=$(sysctl -n hw.ncpu); gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
else cores=$(nproc); gb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1048576 )); fi
echo "$r in $(( $(date +%s) - start ))s on $cores cores, $gb GB"

if [ "$MAC" ]; then
  # What the agents are running, in this Mac's menu bar (#3951): SwiftBar runs ~/builder/bar/bob.10s.sh every 10 s,
  # which reads the run records scripts/remote-ci.ts leaves in ~/builder/runs. No daemon, no root, nothing else.
  say "Menu bar: what the builder is running"
  mkdir -p "$ROOT/runs/done" "$ROOT/bar"
  if [ -f "$ROOT/slot-1/scripts/builder-bar.ts" ] && bun build "$ROOT/slot-1/scripts/builder-bar.ts" --target bun --outfile "$ROOT/bar.js" >/dev/null; then
    printf '#!/bin/sh\nexec "$HOME/.bun/bin/bun" "$HOME/builder/bar.js"\n' > "$ROOT/bar/bob.10s.sh"
    chmod +x "$ROOT/bar/bob.10s.sh"
    if [ -d /Applications/SwiftBar.app ]; then
      defaults write com.ameba.SwiftBar PluginDirectory -string "$ROOT/bar"
      open -a SwiftBar && echo "SwiftBar shows \"Bob: idle\"; in its menu, Preferences > Launch at login"
    else
      echo "missing SwiftBar: brew install --cask swiftbar, then run this again"
    fi
  else
    echo "slot-1 has no scripts/builder-bar.ts yet: run this again once it pulls main"
  fi

  # The desktop builds at 05:00 and 17:00 (#2500), from their own clone so they never take an agent's slot.
  say "Nightly desktop builds"
  N="$ROOT/nightly"
  [ -d "$N/src/.git" ] || git clone -q "$REPO" "$N/src"
  git -C "$N/src" pull -q --ff-only origin main
  if [ -f "$N/src/scripts/mac/dev.rustybuns.builder-nightly.plist" ]; then
    P="$HOME/Library/LaunchAgents/dev.rustybuns.builder-nightly.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    sed "s#/Users/YOU#$HOME#g" "$N/src/scripts/mac/dev.rustybuns.builder-nightly.plist" > "$P"
    launchctl unload "$P" 2>/dev/null || true
    launchctl load "$P" && echo "scheduled 05:00 and 17:00; log $N/log, results $N/results.json (bun run builder nightly reads them)"
  else
    echo "main has no nightly plist yet: run this again once it does"
  fi
fi

say "Last step, on the office Mac"
# A cloud VM has no .local name: use its Tailscale name (tailscale up), or its public address.
if [ "$MAC" ]; then name="$(whoami)@$(scutil --get LocalHostName).local"; else name="$(whoami)@$(hostname)"; fi
echo "1. ssh-copy-id $name        (once, so agents get in without a password)"
echo "2. echo 'export BUILDER_HOST=$name' >> ~/.zshenv   then restart the office"
echo "3. bun run builder run scripts bun test ./ci-tier.test.ts   (from a RustyBuns checkout, to check)"
