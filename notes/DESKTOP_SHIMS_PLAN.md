# Plan: webapp -> desktop app shims for ported webpack/Vite apps

A plan, not a feature. Nothing here is built. It answers #1784 (from the #849 owner ask: "shims all over to just give ppl a wow moment of webapp -> desktop app", "just plan this out and call me over").

## Where we are

`init --port-vite` (#1743, #1777) gets a webpack or CRA app building and running as a desktop binary. The host serves the built client on `127.0.0.1`, behind a token, and opens it in Chrome/Edge `--app` mode (`packages/shell-bun/src/launcher.ts`). That is a chromeless Chrome window, so the page still sees a browser: `localStorage`, service workers, `Notification`, `showOpenFilePicker` and the Clipboard API are all Chrome's own. The only shims today are server-side (`packages/shell-bun/src/shims.ts`: `cloudflare:*` and `rwsdk`). Nothing yet makes a ported app feel like a desktop app instead of a tab with the chrome removed.

## What to shim, in order of wow per hour

Each shim is a small script the host injects into the page (one `<script>` tag with a CSP hash, like the existing inline scripts) plus a host route when the page can't do it alone. `targets.desktop.shims` turns each on or off; `init --port-vite` turns on the ones the app's source uses (grep for the API, as it does for servers today).

| # | Shim | What the web app does | What the desktop app gets | Needs the host? |
|---|------|-----------------------|---------------------------|-----------------|
| 1 | **Window** | `document.title`, `window.open`, `beforeunload`, `requestFullscreen`, favicon | App window title and icon follow the page; `window.open` to the same origin opens a second app window, other origins go to the default browser; `beforeunload` guards the real close; remembers size and position per app | Small: store geometry in the data dir |
| 2 | **Storage** | `localStorage`, `IndexedDB`, cookies | They survive. Today the origin is `127.0.0.1:<port>`; a different port is a different origin and the user's data looks wiped. Pin the port per app (fall back and say so), and keep the `--app` profile in the app's data dir | Yes: stable port, profile dir |
| 3 | **Service worker** | Registers one for offline and caching (workbox) | Unregister it by default. The host already serves from disk, so a worker only adds stale-after-update bugs. Opt back in with `shims.serviceWorker: true` | Script only |
| 4 | **File access** | `<input type=file>`, drag-drop, `showOpenFilePicker`, `showDirectoryPicker`, download via Blob + `<a download>` | Native open and save dialogs, last folder remembered, "Open with" and drag onto the app icon pass the file in, downloads land in a chosen folder instead of the browser's. Safari has no File System Access API, so the shim also makes it work there | Yes: dialogs and file routes (splat-desktop's host already does this by hand) |
| 5 | **Notifications** | `Notification.requestPermission()`, `new Notification()` | OS notifications without the permission prompt (`osascript` on macOS, `notify-send` on Linux), a dock/taskbar badge from `navigator.setAppBadge` | Yes: one POST route |
| 6 | **Menus and shortcuts** | none (browser shortcuts only) | App menu (About, Quit, Copy, Paste), `Cmd+Q`, `Cmd+,`; a config `menu` lists page actions that dispatch a `rb:menu` event | Yes, later; the first three are enough for the demo |
| 7 | **Server** | `fetch("/control/...")` to a backend that isn't Node (Go, Python, Rust) | The backend stays what it is and the app's Worker proxies to it. The host starts it (`server.command`, data in the data dir) on a loopback port and the Worker's `fetch` handler forwards `/control/*` there, so the page, the desktop build and the edge build all talk to one Worker. On the edge the same proxy points at a URL the user hosts (a box, a container), so a Go daemon's UI works in both places | Yes: spawn the process and wait for its port; the proxy itself is ordinary Worker code (the largest item, see AdGuard Home) |

Ruled out for v1: Cast, WebUSB/Bluetooth, deep links (`myapp://`), auto-update. Each is real but none changes the first five minutes.

## Try it on the same three apps

Run the guided port again on each, with the shims off, and record what breaks. The expectations below come from the apps' public source and are guesses until the trial; the trial replaces them with a measured table in the PR that builds the shims.

| App | Likely to need | Why it's a good test |
|-----|----------------|----------------------|
| **AdGuard Home** (client, React + webpack) | 7 (the backend is Go and serves `/control/*`), 2 | The server shim decides whether this app runs at all. Proves "web UI for a local daemon" |
| **CyberChef** (webpack, heavy web workers) | 4 (open a file, save output), 3 (it registers a worker), 2 | The cleanest "wow": drop a file on the app icon, get the decoded result saved to disk |
| **jellyfin-web** (webpack, talks to a remote server) | 2 (server URL and login in `localStorage`), 3, 5, 1 (fullscreen, title) | Proves a thin client keeps its login between launches, and that the shim set is not only for offline tools |

## Order of work

1. **Trial run, no shims.** Port all three, launch, list what fails and what feels like a tab. One issue per failure the engine should have caught, per the rule that a port that breaks is a codeSplitter/`init` gap.
2. **Storage (2) and service worker (3).** They cause silent failures (data gone, stale app after rebuild), so they come before anything flashy.
3. **File access (4) and window (1).** The visible part. CyberChef is the demo.
4. **Notifications (5).** Small, and jellyfin-web exercises it.
5. **Server (7)** once AdGuard Home's trial shows the shape it needs. Menus (6) after.

Each step is its own PR with one journey test through the running app (open a file, quit, relaunch, data still there), not source-text assertions.

## Open questions for the owner

- Is `--app` mode in the user's Chrome enough, or do you want a real webview (a Rust shell) so the window is ours and not Chrome's? A webview gives true native menus and a dock icon of our own, but it is a native build per OS (`build:native`), where today's path needs none. This plan assumes Chrome.
- Shims on by default for a ported app, or only the ones `init` detects? The plan assumes detected.
- The plan now proxies non-Node backends through the Worker (shim 7). Is that the shape you want, with the process started by the host?
- Is a Go-backed app like AdGuard Home in scope for the wow demo, or is CyberChef plus jellyfin-web enough?

## Next

When the owner has answered the questions above, start with step 1. README and FRAMEWORKS.md change when shims ship, not before.
