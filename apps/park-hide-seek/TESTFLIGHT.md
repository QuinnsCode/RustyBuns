# Park Hide & Seek on your iPhone with TestFlight

About 30 minutes the first time, 5 minutes for each build after. Needs a Mac with full Xcode and a paid Apple Developer account.

## One time

1. **Team ID.** developer.apple.com > Account > Membership details > Team ID (10 characters).
2. **App record.** appstoreconnect.apple.com > Apps > + > New App. Platform iOS, name "Park Hide & Seek",
   bundle ID `com.quinnscode.parkhideseek` (register it under Certificates, IDs & Profiles first if it isn't listed),
   any SKU.
3. **Tools.** `brew install xcodegen`, and `bun install` at the repo root (the build packs the offline room with bun).
4. **App icon.** The app has none yet, and App Store Connect rejects a build without a 1024x1024 icon. Add an
   `Assets.xcassets/AppIcon` set to `ios/App` and it ships with the next build.

## Every build

```sh
cd apps/park-hide-seek/ios
DEVELOPMENT_TEAM=ABCDE12345 xcodegen
open ParkHideSeek.xcodeproj
```

In Xcode:

1. Pick the **Any iOS Device (arm64)** destination (not a simulator).
2. Signing & Capabilities: tick Automatically manage signing; it finds your team. Allow it to create the
   Associated Domains capability (the app opens `?room=` links).
3. **Product > Archive.** When the Organizer opens: **Distribute App > App Store Connect > Upload**.
4. Raise `CURRENT_PROJECT_VERSION` in `project.yml` before the next archive; a repeated build number is refused.

## Put it on the phone

1. App Store Connect > your app > **TestFlight**. The build shows "Processing" for 5 to 15 minutes, and an email
   says when it is ready. If it asks about export compliance, the answer is already in the app (no custom encryption).
2. **Internal testing** (you and your team, no review): Internal Testing > + > add yourself (your Apple ID must be
   a user under Users and Access) > add the build.
   **External testing** (friends by link, needs a short Beta App Review the first time): External Testing > + >
   add the build > Public Link.
3. On the iPhone install **TestFlight** from the App Store, sign in with the same Apple ID (or open the public
   link), and tap Install.

## What to check on the phone

- Play offline against AI: starts with no network.
- Quick play and Play with friends: need the live edge (`bun run deploy`) and a friend on a second build or phone.
- Sign in with eqosys: returns to the app through `com.quinnscode.parkhideseek:/eqosys`.
- A friend's `https://park-hide-seek.notryanquinn.workers.dev/?room=CODE` link opens the app (universal links
  work only for a build signed by your team, and take a minute after first install).

Builds expire after 90 days. Plain device testing without TestFlight: plug the phone in, choose it as the Xcode
destination and press Run.
