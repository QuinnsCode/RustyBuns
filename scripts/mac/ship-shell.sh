#!/usr/bin/env bash
# The Agent Office shell release, run on the builder Mac instead of a GitHub runner (launchd, twice a day; see
# apps/agent-office/shell/README.md): when a stable agent-office-v<x.y.z> tag is newer than the version in the
# `agent-office-latest` release's latest.json, build the shell for both Macs, sign it, wait for Apple's notarization
# as long as it takes, and publish. Nothing to do when the published version is already current.
# This Mac needs: gh signed in; the Developer ID certificate in the login keychain; ~/.tauri/agent-office.key (the
# updater key, no password); ~/.appstoreconnect/AuthKey.p8 and ~/.appstoreconnect/ids with the lines
# APPLE_API_KEY=<Key ID> and APPLE_API_ISSUER=<Issuer ID>.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
repo=QuinnsCode/RustyBuns
home="$HOME/builder/ship"
mkdir -p "$home"; cd "$home"
mkdir "$home/lock" 2> /dev/null || { echo "a run is already going"; exit 0; }
trap 'rmdir "$home/lock"' EXIT
exec >> "$home/log" 2>&1
echo "== $(date '+%F %T')"

[ -d src ] || git clone -q "https://github.com/$repo" src
git -C src fetch -q --tags --force origin
tag="$(git -C src tag -l 'agent-office-v*' | grep -E -- '-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
[ -n "$tag" ] || { echo "no stable agent-office-v tag yet"; exit 0; }
want="${tag##*-v}"
have="$(gh release download agent-office-latest --repo "$repo" -p latest.json -O - 2> /dev/null | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).version)' 2> /dev/null || echo 0.0.0)"
if [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | tail -1)" = "$have" ]; then echo "published $have is current ($tag)"; exit 0; fi
echo "building $tag; published is $have"

for f in "$HOME/.tauri/agent-office.key" "$HOME/.appstoreconnect/AuthKey.p8" "$HOME/.appstoreconnect/ids"; do
  [ -f "$f" ] || { echo "missing $f: see the shell README"; exit 1; }
done

# A fresh checkout of the tag, apart from src, so this script file is never rewritten while it runs.
rm -rf build; git -C src worktree prune; git -C src worktree add -q --detach "$home/build" "$tag"
cd build && bun install --frozen-lockfile
cd apps/agent-office && bun scripts/rustybunsify.ts compile --all
cd shell && mkdir -p binaries ../out
cp ../dist/agent-office-darwin-arm64 binaries/agent-office-aarch64-apple-darwin
cp ../dist/agent-office-darwin-x64 binaries/agent-office-x86_64-apple-darwin

set -a; . "$HOME/.appstoreconnect/ids"; set +a
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/AuthKey.p8"
export APPLE_SIGNING_IDENTITY="Developer ID Application"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/agent-office.key")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
for pair in aarch64-apple-darwin:darwin-aarch64 x86_64-apple-darwin:darwin-x86_64; do
  triple="${pair%%:*}"; platform="${pair##*:}"
  bunx --bun @tauri-apps/cli@2.9.0 build --target "$triple" --bundles app --config "{\"version\":\"$want\"}"
  bundle="target/$triple/release/bundle/macos"
  cp "$bundle/Agent Office.app.tar.gz"     "../out/agent-office-$platform.app.tar.gz"
  cp "$bundle/Agent Office.app.tar.gz.sig" "../out/agent-office-$platform.app.tar.gz.sig"
done

cd "$home/build"
bun apps/agent-office/scripts/update-manifest.ts --version "$want" --repo "$repo" --tag agent-office-latest --dir apps/agent-office/out > apps/agent-office/out/latest.json
export GH_REPO="$repo"
gh release view agent-office-latest > /dev/null 2>&1 || gh release create agent-office-latest --title "Agent Office updates" --latest=false \
  --notes "The feed the Agent Office shell's Check for updates reads. Rewritten when a stable agent-office-v tag is built; don't download from here."
# The bundles first, the manifest last: a client never sees latest.json pointing at a file that isn't there yet.
gh release upload agent-office-latest apps/agent-office/out/*.tar.gz apps/agent-office/out/*.sig --clobber
gh release upload agent-office-latest apps/agent-office/out/latest.json --clobber
echo "published $want"
