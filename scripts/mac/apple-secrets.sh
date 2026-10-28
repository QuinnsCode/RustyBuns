#!/usr/bin/env bash
# Puts the Apple signing secrets (APPLE_SIGNING.md step 7) on GitHub, in the `drops` environment, so nobody copies a
# file's text by hand. It reads the newest file in ~/Downloads, asks a plain question or two, and checks before it sends.
#   scripts/mac/apple-secrets.sh p12      the certificate file (.p12) and the password you set when you exported it
#   scripts/mac/apple-secrets.sh notary   the notary key (AuthKey_XXXX.p8) and its Issuer ID
set -euo pipefail
repo=QuinnsCode/RustyBuns
mode="${1:-}"
[ "$mode" = p12 ] || [ "$mode" = notary ] || { echo "usage: apple-secrets.sh p12|notary"; exit 1; }
gh auth status > /dev/null 2>&1 || { echo "gh isn't signed in on this Mac. Run: gh auth login"; exit 1; }

# The value comes on stdin, so it never shows on a command line or in the shell history.
put() { printf '%s' "$2" | gh secret set "$1" --env drops --repo "$repo" > /dev/null && echo "  set $1"; }
newest() { ls -t "$HOME"/Downloads/$1 2> /dev/null | head -1; }

if [ "$mode" = p12 ]; then
  file="$(newest '*.p12')"
  [ -n "$file" ] || { echo "No .p12 file in your Downloads folder."; exit 1; }
  echo "Certificate file: $file"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  for try in 1 2 3; do
    read -rsp "Type the password you chose when you exported it (nothing shows as you type): " pw; echo
    security create-keychain -p tmp "$tmp/t.keychain-db"
    if security import "$file" -k "$tmp/t.keychain-db" -P "$pw" 2>&1 | grep -q "identity imported"; then
      security delete-keychain "$tmp/t.keychain-db"
      echo "That password opens the file."
      put APPLE_DEVELOPER_ID_P12 "$(base64 -i "$file" | tr -d '\n')"
      put APPLE_DEVELOPER_ID_P12_PASSWORD "$pw"
      echo "Done. Both secrets are on GitHub."
      exit 0
    fi
    security delete-keychain "$tmp/t.keychain-db" 2> /dev/null || true
    echo "That password does not open the file (try $try of 3)."
  done
  echo "Nothing was sent. Export the certificate again with a password you write down first."
  exit 1
fi

file="$(newest 'AuthKey_*.p8')"
[ -n "$file" ] || { echo "No AuthKey_….p8 file in your Downloads folder."; exit 1; }
id="$(basename "$file" .p8)"; id="${id#AuthKey_}"
echo "Notary key file: $file"
echo "Its Key ID is $id (it is in the file's name)."
read -rp "Issuer ID (the long code with dashes above the table on the App Store Connect page): " issuer
[[ "$issuer" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "That doesn't look like an Issuer ID: 36 characters, letters, numbers and dashes."; exit 1; }
put APPLE_NOTARY_KEY_P8 "$(cat "$file")"
put APPLE_NOTARY_KEY_ID "$id"
put APPLE_NOTARY_ISSUER_ID "$issuer"
echo "Done. All three secrets are on GitHub."
