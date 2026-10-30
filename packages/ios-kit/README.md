# RustyBunsKit

What every RustyBuns iOS app needs from the platform, as one Swift package, so an app's own code is only its game or
suite. Its rules stay in TypeScript on the edge; the app draws what the edge sends. Park Hide & Seek
(`apps/park-hide-seek/ios`) is the first app built on it.

| Piece | What it does |
| --- | --- |
| `EqosysClient` | eqosys as an OpenID provider (`apps/eqosys/src/oauth.ts`): PKCE to the app's own scheme, the token, refresh, revoke and delete requests, the nonce check. Plain values, so it tests without a phone. |
| `EqosysAuth` | The signed-in person, kept in the Keychain: `signIn(present:)` once, then `token()` before every edge call hands out a fresh ten-minute token and refreshes behind the scenes. `signOut()` revokes at eqosys; `deleteAccount()` is App Store 5.1.1(v). |
| `EqosysSignIn.present` | Apple's web authentication sheet on the app's scheme (iOS 16, no associated domains needed). Not ephemeral, so one eqosys sign-in covers every Q app on the phone: the second app is a tap on Continue. |
| `HubLink`, `HubState`, `HubOp` | The friends hub: who is on and in which app, requests, notifications, and `.status("hiding in the hedge")`. |
| `EdgeProtocol`, `Trouble` | The protocol version handshake (`@rustybuns/util/protocol`): `pv` on every call, HTTP 426 or close 4426 means "Update to keep playing". |

## Hooking an app up

1. In `apps/eqosys/src/apps.ts`, give the app `schemes: ["<bundle id, lowercased>"]`. It comes back to `<bundle id>:/eqosys`.
2. In the app's `Package.swift`: `.package(path: "../../../packages/ios-kit")` and the `RustyBunsKit` product.
3. In the app:

```swift
let auth = EqosysAuth(client: EqosysClient(app: "park-hide-seek", bundleId: "com.quinnscode.parkhideseek"))
try await auth.signIn(present: EqosysSignIn.present)     // the Sign in button
let token = try await auth.token()                      // before each socket or call; nil when signed out
```

`token()` throws `EqosysError.signInAgain` once the session is gone (revoked, the account deleted, a month unused): show the
sign-in button again.

## Tests

`cd packages/ios-kit && swift test` with full Xcode. The Command Line Tools have no XCTest; there the tests were run through a
small local stand-in module, not checked in.
