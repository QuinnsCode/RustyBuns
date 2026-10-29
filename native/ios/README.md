# Rusty Buns for iOS (test branch)

The smallest phone client: a SwiftUI app that asks for the address of a deployed Rusty Buns app, then shows it
full screen in a `WKWebView`. Links to other sites open in Safari. `rustybuns://open?url=https://my-app.workers.dev`
opens an app from a link.

It is a web view on purpose. Apps already run on Workers, and `scripts/phone-smoke.ts` tells us which fit a phone.
A native SwiftUI screen per app comes after this proves the loop. Running an app on the phone itself (the desktop
Bun shell) is not possible on iOS.

- `Sources/RustyBunsKit`: address parsing and the which-links-stay-inside rule. Plain Swift, tested on macOS:
  `cd native/ios && swift test`.
- `App/`: the SwiftUI app. `xcodegen` makes the Xcode project from `project.yml`; run it in the simulator.
- `bun run ios https://my-app.workers.dev level=5 --build` (from the repo root) builds it, installs it in a simulator
  and opens that app already in a state. Needs full Xcode and `brew install xcodegen`.

Not done: sign-in (the desktop launch token does not work over the internet), push, App Store signing.
