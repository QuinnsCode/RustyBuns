# Agent Office shell (spike)

A Tauri app with no window and no webview. The compiled Bun binary stays the app: it serves the page and opens
Chrome with `--app`. The shell adds a Dock icon, a menu bar, Cmd-Q that stops the binary, and a Dock click that
brings the Chrome window forward. A menu bar (tray) icon offers Open Agent Office, Launch at login (a macOS
LaunchAgent via `tauri-plugin-autostart`) and Quit.

Updates: "Check for updates" in the tray reads `latest.json` from the `agent-office-latest` release and installs a
build signed with the minisign key whose public half is in `tauri.conf.json`. The private key (`TAURI_SIGNING_PRIVATE_KEY`, a repo secret; it has no password) stays with the owner;
`cargo tauri build` needs it because `createUpdaterArtifacts` is on.
`.github/workflows/agent-office-shell.yml` does the rest: a stable `agent-office-v<x.y.z>` tag builds the shell for both
Macs with that version, signs the update bundles and moves the rolling `agent-office-latest` release (bundles, then
`latest.json` from `scripts/update-manifest.ts`) to them. A PR that touches the shell builds it unsigned and publishes nothing.
`cargo check` needs a placeholder file at `binaries/agent-office-<target triple>` (gitignored) for the build script.

```sh
bun run desktop:build                               # ../dist/agent-office-<os>-<arch>
RB_BINARY=../dist/agent-office-darwin-arm64 cargo run
```

To bundle: copy the binary to `binaries/agent-office-<rust target triple>` (for example
`aarch64-apple-darwin`), then `cargo tauri build`. Tauri puts it next to the shell's executable.

## Signing

Sign once, at the outer layer. `cargo tauri build` signs every executable inside the `.app`, the Bun binary
included, with `APPLE_SIGNING_IDENTITY`, then notarizes the bundle (`APPLE_API_KEY`, `APPLE_API_ISSUER`,
`APPLE_API_KEY_PATH`). The bare binary no longer goes through `scripts/mac/sign.ts`. Bun needs JIT entitlements
under the hardened runtime, so give Tauri an entitlements file (`bundle.macOS.entitlements`) with
`allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation`. If the app ships updates
through Tauri's updater, that has its own minisign key, separate from Apple's.

The Apple Developer ID signing and notarization of the `.app` is not wired into `agent-office-shell.yml` yet, so a
fresh download is blocked by Gatekeeper; an update through the tray is not (the updater's download carries no quarantine flag).
