# Apple signing

The Mac binaries on the releases page aren't signed, so macOS blocks a double click and the
first launch takes a Terminal command. Fixing that takes a paid Apple Developer account, a
**Developer ID Application** certificate, and notarization. This guide gets the account and the
credentials; step 7 hands them to `desktop-drop.yml`.

Everything here is done by a person, once. Nothing in this repo asks Apple for anything.

## 1. Pick how to enroll

The Apple Developer Program costs $99 a year (USD, or the local price), renewed yearly. You
enroll as one of two kinds:

| | Individual | Organization |
|---|---|---|
| Gatekeeper shows | your legal name | the company's legal name |
| Needs | an Apple Account with two-factor auth, a government photo ID | a legal entity (LLC, corp; not a DBA), a D-U-N-S number, a website on the company's domain, the authority to sign for it |
| Usually takes | a day or two | a week or more: D-U-N-S lookup or request, then Apple calls to verify |
| Adding people later | no team members | invite others with roles |

Individual is the quick path. Moving an individual account to an organization later is a
request to Apple support, not a button, so if a company name on the "Open" dialog matters,
start with Organization.

## 2. Before you start

- An Apple Account with two-factor authentication on. Use one you'll keep: it becomes the
  Account Holder, the only role that can make Developer ID certificates.
- Your legal name exactly as on your ID (individual), or the entity's legal name exactly as
  D-U-N-S has it (organization). A mismatch is the most common reason enrollment stalls.
- **Organization only:** look up or request your D-U-N-S number through Apple's
  [D-U-N-S lookup](https://developer.apple.com/enroll/duns-lookup/). A new number is free; it can
  take a few business days, and a couple more to reach Apple.

## 3. Enroll

The fastest route is the **Apple Developer** app on an iPhone, iPad or Mac (App Store, free):
sign in, Account, **Enroll Now**. It scans your ID and takes the payment through your Apple
Account. The web route is [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/).

Then wait for the "Welcome to the Apple Developer Program" email. Once it arrives,
[developer.apple.com/account](https://developer.apple.com/account) shows your **Team ID**
(10 characters, under Membership details). Note it down; it isn't secret.

## 4. Make the Developer ID Application certificate

This is the certificate for apps shipped outside the Mac App Store, which is what the releases
page does. On the Mac you'll sign from:

1. Install Xcode (or at least sign in to Xcode once; the command line tools alone don't manage
   certificates).
2. Xcode → Settings → Accounts → add your Apple Account → select the team → **Manage
   Certificates** → **+** → **Developer ID Application**.

Xcode makes the private key in your login keychain and the certificate on Apple's side. Check it:

```sh
security find-identity -v -p codesigning
# 1) ABCDEF…  "Developer ID Application: Your Name (TEAMID1234)"
```

A Developer ID certificate lasts five years and you can only hold a few at a time, so don't make
spares. Binaries signed with it keep working after it expires, as long as they were notarized.

**Back it up now.** Keychain Access → My Certificates → right-click the Developer ID Application
entry (with its key) → Export → `.p12` with a strong password. Put the `.p12` and its password in
1Password. Lose the key and you have to revoke and make another.

## 5. Make an App Store Connect API key for notarization

Notarization uploads each build to Apple, which scans it and approves it. CI logs in with an API
key, not your password:

1. [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations →
   **App Store Connect API** → Team Keys → **+**.
2. Name it `rustybuns-notary`, access **Developer**.
3. Download the `.p8`. Apple lets you download it **once**. Note the **Key ID** and the
   **Issuer ID** shown above the table.
4. Put all three in 1Password, next to the certificate.

Save it on your Mac too, so you can notarize by hand:

```sh
xcrun notarytool store-credentials rustybuns-notary \
  --key ~/Downloads/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer xxxxxxxx-xxxx-…
```

Then delete the downloaded `.p8`; 1Password holds the copy.

## 6. Try it on one binary

Bun's compiled binaries run JavaScriptCore's JIT, which the hardened runtime blocks unless the
signature says otherwise. Save this as `entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-executable-page-protection</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
```

`disable-library-validation` is for apps with a Rust cdylib from `native/`: the binary loads it
at runtime, and without the entitlement macOS only loads libraries signed by the same team.

Sign, notarize, check:

```sh
codesign --sign "Developer ID Application: Your Name (TEAMID1234)" \
  --options runtime --timestamp --entitlements entitlements.plist --force \
  hippo-tycoon-darwin-arm64
ditto -c -k hippo-tycoon-darwin-arm64 hippo-tycoon.zip    # notarytool takes a zip, dmg or pkg
xcrun notarytool submit hippo-tycoon.zip --keychain-profile rustybuns-notary --wait
spctl --assess --type execute -vv hippo-tycoon-darwin-arm64   # "accepted, source=Notarized Developer ID"
```

A bare binary can't have its ticket stapled (only `.app`, `.dmg` and `.pkg` can), so Gatekeeper
checks with Apple online the first time it runs. If a submission comes back **Invalid**,
`xcrun notarytool log <id> --keychain-profile rustybuns-notary` says which file and why.

Run the signed binary once to be sure the entitlements are enough: a JIT crash shows up right
at start.

## 7. Hand it to CI

The release pipeline needs these, as secrets on the `drops` environment (owner-only, like the
R2 token there):

| Secret | What |
|---|---|
| `APPLE_DEVELOPER_ID_P12` | the exported `.p12`, base64 (`base64 -i cert.p12`) |
| `APPLE_DEVELOPER_ID_P12_PASSWORD` | its password |
| `APPLE_TEAM_ID` | the Team ID (not secret, but kept with the rest) |
| `APPLE_NOTARY_KEY_P8` | the `.p8` file's contents |
| `APPLE_NOTARY_KEY_ID` | the Key ID |
| `APPLE_NOTARY_ISSUER_ID` | the Issuer ID |

Once they're there, every drop signs and notarizes its `darwin-*` binaries before the upload:
the drop job runs on a Mac and calls `scripts/mac/sign.sh`, which loads the `.p12` and the notary
key into a throwaway keychain and signs with the same code as `rustybuns build desktop --sign
--notarize`. The release notes and the drop page then say "signed and notarized" instead of the
`xattr` workaround. Without the secrets (a PR's dry run, or before you enroll) the step signs
nothing and the workaround stays.

Windows signing (the SmartScreen warning) is a separate certificate from a different seller and
isn't covered here.

## Signing is not the download's TLS

A Developer ID signature and notarization are checked against Apple's own roots, not the
`/etc/ssl/cert.pem` bundle that `curl` and Git use. A reported weakness in that bundle (a CA whose
keys leaked, so an attacker can forge certificates for any host) doesn't touch a signed, notarized
app: Gatekeeper still rejects a swapped binary. It does touch anything fetched with `curl … | sh`,
because a forged certificate lets an on-path attacker swap the script, and `SHA256SUMS` served from
the same host swaps with it. Two things hold up either way: ship the Mac binaries signed and
notarized (step 7), and prefer a download that is checked against something not fetched from the
same place (a signature, or a hash given out of band) over one that is only fetched over TLS.
