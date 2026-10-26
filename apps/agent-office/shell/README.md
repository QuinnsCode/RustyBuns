# Agent Office shell (spike)

A Tauri app with no window and no webview. The compiled Bun binary stays the app: it serves the page and opens
Chrome with `--app`. The shell adds a Dock icon, a menu bar, Cmd-Q that stops the binary, and a Dock click that
brings the Chrome window forward.

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

Not wired into `scripts/ci-apps.ts` or `desktop-drop.yml` yet.
