#!/usr/bin/env bash
# Sign and notarize the Mac binaries in a folder, in place: desktop-drop.yml's drop job runs it
# before the upload. The credentials are the `drops` environment secrets from APPLE_SIGNING.md
# step 7. Without them (a PR, or before the owner enrolls) it signs nothing and says so, and the
# release notes keep the xattr workaround. Writes signed=true|false to $GITHUB_OUTPUT.
# This half loads a throwaway keychain; sign.ts does the signing, with the CLI's --sign code.
#   APP=hippo-tycoon scripts/mac/sign.sh bins
set -euo pipefail
dir="${1:?usage: sign.sh <dir>}"
out="${GITHUB_OUTPUT:-/dev/null}"
shopt -s nullglob
bins=("$dir"/*-darwin-*)

if [ -z "${APPLE_DEVELOPER_ID_P12:-}" ]; then
  echo "no APPLE_DEVELOPER_ID_P12: Mac binaries stay unsigned"
  echo "signed=false" >> "$out"; exit 0
fi
[ -n "${APP:-}" ] || { echo "APP isn't set: the app the binaries belong to"; exit 1; }
for v in APPLE_DEVELOPER_ID_P12_PASSWORD APPLE_TEAM_ID APPLE_NOTARY_KEY_P8 APPLE_NOTARY_KEY_ID APPLE_NOTARY_ISSUER_ID; do
  [ -n "${!v:-}" ] || { echo "APPLE_DEVELOPER_ID_P12 is set but $v isn't (APPLE_SIGNING.md step 7)"; exit 1; }
done
[ ${#bins[@]} -gt 0 ] || { echo "no *-darwin-* binaries in $dir"; exit 1; }

# A throwaway keychain holds the certificate and notary key for this job only; the trap deletes it and the key files.
tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/sign.XXXXXX")"
kc="$tmp/sign.keychain-db"
kcpw="$(uuidgen)"
cleanup() { security delete-keychain "$kc" 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT
printf '%s' "$APPLE_DEVELOPER_ID_P12" | base64 --decode > "$tmp/cert.p12"
printf '%s\n' "$APPLE_NOTARY_KEY_P8" > "$tmp/notary.p8"
security create-keychain -p "$kcpw" "$kc"
security set-keychain-settings -lut 3600 "$kc"
security unlock-keychain -p "$kcpw" "$kc"
security import "$tmp/cert.p12" -k "$kc" -P "$APPLE_DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$kcpw" "$kc" > /dev/null
security list-keychains -d user -s "$kc" $(security list-keychains -d user | tr -d '"')

security default-keychain -s "$kc"   # notarytool reads its profile from the default keychain
xcrun notarytool store-credentials rustybuns-ci --key "$tmp/notary.p8" \
  --key-id "$APPLE_NOTARY_KEY_ID" --issuer "$APPLE_NOTARY_ISSUER_ID" --keychain "$kc" > /dev/null

bun "$(dirname "$0")/sign.ts" "$APP" "${bins[@]}"
echo "signed=true" >> "$out"
