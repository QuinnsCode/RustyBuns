# Splat desktop

[SuperSplat](https://github.com/playcanvas/supersplat), PlayCanvas' open-source web editor for 3D Gaussian splats, as a desktop app. Open a folder of scenes, edit them, and keep everything on your disk. Built with [RustyBuns](../../README.md). More examples: [EXAMPLES.md](../../EXAMPLES.md).

This is phase 1 of a bigger idea: **phone video in, 3D scene out, trained on your own GPU.** Phase 1 brings the editor to the desktop; training with [Brush](https://github.com/ArthurBrussee/brush) comes next (see [Roadmap](#roadmap)).

## You need Bun to build it. Your users need nothing.

`rustybuns build desktop` produces one self-contained file (about 90 MB): the scene library, the backend, and SuperSplat itself. Download, double-click, done.

## What it does

- **Your scene library.** Open any folder with the system folder picker. Every `.ply`, `.spz`, `.sog`, `.splat`, `.ksplat`, `.lcc` and `.ssproj` file in it (and its subfolders) is listed, and the list updates as files appear.
- **SuperSplat, unmodified.** Click a scene to open it in the full editor: crop, trim floaters, retouch colors, animate cameras, export. SuperSplat's own save dialogs write straight to disk.
- **Combine scenes.** The **+** next to a scene adds it to the scene already open.
- **Big files.** Scenes are served from disk with byte-range support, so multi-gigabyte captures don't go through a browser upload.
- **Scene details.** Selecting a scene shows its splat count, detail level and size, read from disk on the host.
- **Unsaved-changes guard.** Switching scenes asks first if the editor has edits.

## Build it yourself

You need [Bun](https://bun.sh) 1.4+ and git.

```
git clone https://github.com/QuinnsCode/RustyBuns
cd RustyBuns && bun install
cd apps/splat-desktop
bun run desktop:dev          # first run fetches and builds SuperSplat (a minute or two)
bun run desktop:build        # the single file: dist/splat-desktop-<os>-<arch>
```

- **Browser:** SuperSplat needs WebGPU, so the app works best in Chrome or Edge, which it opens as an app window when installed. Recent Safari also works.
- **First run on macOS:** the binary is unsigned, so right-click → Open, or run `xattr -d com.apple.quarantine <file>`.
- **No scenes yet?** `bun scripts/make-test-splat.ts ~/Splats/ring.ply` writes a small test scene.
- **Tests:** `bun test` covers the host (file serving, byte ranges, path escapes), scene details, the editor URL encoding, and whether the pinned SuperSplat still has the hook the app uses.

## Make it your own

[EXTENDING.md](EXTENDING.md) walks you through copying this app into your own project, explains where code goes by building the scene-details feature step by step, and gives you exercises to build next: renaming, format conversion, thumbnails, a Rust fast path, and GPU training.

## How it fits together

```
App window
  Shell (Vite + React): scene library, recent folders
  └─ iframe /editor/   SuperSplat, built unmodified from a pinned commit
       opened with ?load=/files/<scene>
       "+" calls SuperSplat's own "import" event through window.scene.events
Bun host (the binary)
  desktop/host.ts   folder picker, scene list, file watching, /files/* with byte ranges
```

| File | Role |
|------|------|
| `rustybuns.config.ts` | The wiring: `host` names the backend, `headers` lets CDN assets load. |
| `scripts/build-editor.ts` | Fetches SuperSplat at `SUPERSPLAT_COMMIT`, builds it for `/editor/`, copies it into the UI build, writes the license notices. |
| `src/editorBridge.ts` | Everything the shell does to the editor: opening URLs, adding scenes, checking for unsaved changes. |
| `desktop/host.ts` | The backend routes. |
| `desktop/sceneInfo.ts` | Reads splat count, detail level and bounds from scene files (the worked example in EXTENDING.md). |

**Updating SuperSplat:** change `SUPERSPLAT_COMMIT`, run `bun run build`, then `bun test`. The app relies on SuperSplat's internal `window.scene.events` (its own UI uses it), which isn't a documented API; `tests/editor-hook.test.ts` fails if a new version changes it.

## Roadmap

1. **Editor on the desktop.** Done.
2. **Train from photos.** Folders of photos with camera positions (COLMAP format) trained with Brush, a Rust splat trainer that runs on Metal, Vulkan and DirectX. Training runs as its own process with live progress and cancel, and checkpoints load into the editor as they improve.
3. **Train from video.** Frame extraction and camera-position solving (COLMAP/GLOMAP) bundled in. Without a capable GPU, Brush's browser build (the same Rust code as WebAssembly) takes over.

## Known limits

- **WebGPU required.** SuperSplat shows an error in browsers without it.
- **The 3D view has no automated test.** It needs a real GPU. The automated tests cover everything around it; check the view and adding scenes by hand after updating SuperSplat.

## Licenses

`bun run build` writes `THIRD_PARTY_LICENSES.txt` for the shell and for everything SuperSplat's build bundles (its dependencies minus build tooling), plus the Bun runtime. It ships inside the binary (linked from the app, served at `/THIRD_PARTY_LICENSES.txt`) and in `dist/` for publishing with downloads. `LICENSES_STRICT=1 bun run build` fails on anything that needs review.

**Review before distributing:** `mediabunny` (MPL-2.0), which SuperSplat uses for video export. MPL-2.0 is file-level copyleft: shipping it unmodified with its notice is normally fine, but confirm for your release.

SuperSplat is MIT-licensed, © PlayCanvas Ltd. This is an inventory, not legal advice.
