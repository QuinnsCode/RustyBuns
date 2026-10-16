# Windows and Linux signing

The Windows binaries on the releases page aren't signed, so SmartScreen shows "Windows protected
your PC" and the user has to click More info, then Run anyway. This guide is the road to fixing
that, and answers whether Linux needs a key too. [APPLE_SIGNING.md](APPLE_SIGNING.md) is the Mac
half; the Apple account is already done.

Everything here is done by a person, once. Nothing in this repo asks Microsoft for anything.

## The short answers

- **"Microsoft dev account" for signing:** not the one most people find first. Windows code
  signing comes from **Azure Artifact Signing** (Microsoft's own service, formerly called Trusted
  Signing), about **$10 a month**, or from a certificate you buy from a certificate company. The
  **Partner Center** developer account ($19 for individuals, one time) is for the Microsoft Store
  and does not sign downloads.
- **Linux:** there is no key to buy. Linux doesn't check a signature before it runs a file.
  Publishing a checksum file is enough, and a GPG key is only needed if we later ship an apt or
  yum repository.
- **Apple:** done. The Developer ID certificate covers the Mac binaries.

## Windows: what you do

Prices and eligibility change. Check the Azure page for your country before you pay.

### 1. Make a Microsoft Azure account

1. Go to [portal.azure.com](https://portal.azure.com) and sign in with a Microsoft account (make
   one if you don't have it; use an address you'll keep).
2. Start a subscription (**Pay-as-you-go**). It needs a credit card. Nothing is charged until you
   make something that costs money.

### 2. Make the signing account

1. In the Azure portal search bar type **Artifact Signing** (it may still say **Trusted
   Signing**) and open it.
2. **Create**. Pick your subscription, make a new resource group called `rustybuns`, name the
   account `rustybuns-signing`, and choose the **Basic** price (about $10 a month).
3. Wait for "deployment complete".

### 3. Prove who you are (identity validation)

This is the slow step. Microsoft checks that you are a real person or company before it lets you
sign in your name.

1. Open your signing account, then **Identity validations**, then **New identity**.
2. Pick **Individual** or **Organization**. As of this writing individuals are accepted in the US
   and Canada, organizations in the US, Canada, the EU and the UK, and an organization has to be
   a registered business that is at least three years old. If you don't fit, go to
   "If Azure won't take you" below.
3. Enter your legal name exactly as on your government ID, and finish the ID check on your phone.
4. Wait for **Completed**. It takes from minutes to a few days.

### 4. Make the certificate profile

1. In the signing account, **Certificate profiles**, then **Create**, type **Public Trust**.
2. Pick the identity you just validated and name it `rustybuns`.

### 5. Let GitHub sign for us

CI signs with a robot login, not your password.

1. Azure portal, **Microsoft Entra ID**, **App registrations**, **New registration**. Name it
   `rustybuns-ci`. Write down the **Application (client) ID** and the **Directory (tenant) ID**.
2. In that app, **Certificates & secrets**, **New client secret**. Copy the **Value** now; Azure
   shows it once.
3. Open the signing account, **Access control (IAM)**, **Add role assignment**, role **Artifact
   Signing Certificate Profile Signer** (or **Trusted Signing Certificate Profile Signer**), and
   give it to `rustybuns-ci`.
4. Put these in 1Password, next to the Apple items: tenant ID, client ID, client secret, the
   signing account name, the certificate profile name, and the endpoint shown on the signing
   account's overview page (for example `https://eus.codesigning.azure.net`).

### 6. Hand them to us

Tell the agent the names are in 1Password. Wiring them into `desktop-drop.yml` is a follow-up: a
Windows step that signs `*-windows-*.exe` with the `azure/artifact-signing-action` (or
`azure/trusted-signing-action`), the same way `scripts/mac/sign.sh` does the Mac files. Agents
never read the secret values.

### If Azure won't take you

Buy an **OV code signing certificate** (about $200 to $400 a year) from DigiCert, Sectigo,
SSL.com or similar. Since 2023 the private key must live on a hardware token or a cloud signer
the seller runs, so you can't download a `.pfx` for CI; pick a seller with a cloud-signing option.
An EV certificate costs more and used to skip SmartScreen warnings at once; today a new
certificate of either kind still builds reputation over the first downloads.

## Linux: what you do

Nothing is required. If you want it nicer:

1. Publish a `SHA256SUMS` file beside the Linux binaries so people can check a download.
2. Later, if we make a `.deb` or `.rpm` repository, make a GPG key (`gpg --full-generate-key`),
   store the private key in 1Password, and publish the public key. Skip this until then.

## What stays unsigned until the Windows step lands

The release notes keep their SmartScreen line (`More info`, then `Run anyway`). Once Windows
signing is in `desktop-drop.yml`, drop that line the way the Mac note drops its `xattr` line.
