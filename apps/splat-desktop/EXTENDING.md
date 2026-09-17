# Extending splat desktop

This guide takes you from "it runs" to "it's mine": copy the app out, learn where code goes by walking through one real feature, then build your own.

## 1. Make it yours

The app lives in the RustyBuns repo and uses the framework's local packages (`workspace:*`). To start your own project from it:

1. **Copy the folder** somewhere new, and `git init` there.
2. **Point at the published framework.** In `package.json`, replace the `workspace:*` versions:
   ```json
   "@rustybuns/shell-bun": "^0.2.0",
   "@rustybuns/cli": "^0.2.0"
   ```
   The features this app uses (`host`, `headers`) arrive in RustyBuns 0.2.0. Until that version is on npm, keep the app inside the repo.
3. **Rename it.** Change `"name"` in `package.json` and in `rustybuns.config.ts` (that's the binary's name), `dataDir` in `rustybuns.config.ts` (where recent folders are stored), `APP_NAME` in `scripts/licenses.ts`, and the `<title>` in `index.html`.
4. **Install and check.**
   ```
   bun install
   bun run build
   bun test
   bun run desktop:dev
   ```

## 2. Where code goes

| You want to… | Put it in | Runs in |
|---|---|---|
| Read or write files, run programs, use the network freely | `desktop/host.ts` (a route) and its own module in `desktop/` | The Bun host (the binary) |
| Show something | `src/` (React) | The app window |
| Make SuperSplat do something | `src/editorBridge.ts` | The app window, calling into the editor |
| Ship native code | `native/` with `native` in `rustybuns.config.ts` | The host, through `bun:ffi` |

The browser can't touch your disk or run programs; the host can. So features usually come in pairs: a host route that does the work, and UI that calls it.

## 3. Worked example: scene info

When you select a scene, the sidebar shows its splat count, detail level and size. It touches every layer once.

**The work: `desktop/sceneInfo.ts`.** A plain module with no web code in it, so it's easy to test. It reads the PLY header from the first 64 KB, then streams the positions to find the bounding box:

```ts
export async function readSceneInfo(path: string): Promise<SceneInfo> {
  // cached by path + size + modified time, so re-selecting a scene is instant
  ...
  const info = ext === "ply" ? await plyInfo(path) : ...;
}
```

Three habits worth copying:
- **Stream, don't load.** Scenes can be gigabytes. `Bun.file(path).slice(a, b).stream()` reads a range without loading the file; the code handles records that straddle two chunks.
- **Say what's unknown.** Formats it can't read return `null` fields plus a `note` explaining why, instead of guessing or throwing.
- **Keep it fast enough.** 3 million splats (204 MB) takes about 0.2 s. Measure before optimizing.

**The route: `desktop/host.ts`.** Every file path from the browser goes through `inLibrary()`, which refuses anything outside the open folder:

```ts
if (path === "/api/library/info") {
  const p = inLibrary(url.searchParams.get("path") ?? "");
  if (!p || !SCENE_EXT.has(extname(p).toLowerCase()) || !existsSync(p)) return bad("not found", 404);
  return json(await readSceneInfo(p));
}
```

**The client call: `src/api.ts`.**

```ts
info: (path: string) => call<SceneInfo>(`/api/library/info?path=${encodeURIComponent(path)}`),
```

**The UI: `src/Workspace.tsx`.** Fetch when the selected scene changes, and again when the library reloads (the file may have changed on disk):

```tsx
useEffect(() => {
  setInfo(null);
  if (!current) return;
  let live = true;
  api.info(current.path).then((i) => live && setInfo(i), () => {});
  return () => { live = false; };   // ignore answers for a scene you've already left
}, [current, scenes]);
```

`SceneInfoPanel`, at the bottom of the same file, renders it.

**The tests: `tests/scene-info.test.ts` and `tests/host.test.ts`.** The module is tested against generated files (`scripts/make-test-splat.ts`), including a truncated file and a record split across stream chunks. The route test checks the path guard. Test the module directly and keep route tests thin.

## 4. Your turn

Each exercise lists what to build, hints, and how to know it works. They get harder as you go.

### Rename and duplicate scenes

Add **Rename** and **Duplicate** to each scene in the library.

- **Host:** `POST /api/library/rename {from, to}` and `POST /api/library/duplicate {path}`. Run both paths through `inLibrary()`, refuse to overwrite existing files, and keep the extension a scene extension.
- **UI:** you don't need to refresh the list yourself. The file watcher already sends a change event and the library reloads.
- **Done when:** a test renames a file and a second test proves `{"from": "ring.ply", "to": "../ring.ply"}` is refused.

### Convert formats

Add **Save as SOG / SPZ / compressed PLY** to a scene. `.sog` files are often a fraction of the size of the source PLY.

- **Library:** [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform) (MIT) reads and writes all of these; it's what SuperSplat itself uses. `bun add @playcanvas/splat-transform`, and check its docs for the current API.
- **Use the library, not its CLI.** Inside the compiled binary there's no `node_modules/.bin` to run. Import it in a host module so it's bundled.
- **Licenses:** add it to `HOST_ROOTS` in `scripts/licenses.ts` so its notices ship.
- **Long jobs:** converting a big scene takes a while. Return a job id right away and report progress over `/api/library/events` (or its own event stream) instead of holding the request open.
- **Done when:** a converted file appears in the library by itself, and `/api/library/info` reports the same splat count as the source.

### Thumbnails

Show a small preview next to each scene.

- **Cheap version:** a top-down plot of splat positions and colors (the `f_dc_*` values; `scripts/make-test-splat.ts` shows how they map to color). Draw it on a canvas in the UI, or produce a PNG on the host.
- **Cache it** in the data folder (`ctx.dataDir`), keyed by path, size and modified time, like `readSceneInfo`.
- **Done when:** a library of 50 scenes scrolls smoothly and previews appear without reopening scenes.

### Move the heavy loop to Rust

Only once a real file makes you wait. Measure with the biggest scene you have first.

- **Pattern:** `apps/tscircuit-desktop` has the full recipe:
  - a crate in `native/crates/`,
  - `loadNative()` in `desktop/native.ts`,
  - `native: ["your_crate"]` in `rustybuns.config.ts`,
  - a TypeScript twin as the fallback,
  - a parity test that keeps the two equal.
- **Good first target:** the bounds scan in `plyInfo`. It's a tight loop over a flat buffer, easy to parallelize with rayon.
- **Done when:** the parity test passes, and your benchmark shows a real gain on multi-GB files.

### Train scenes on the GPU

The roadmap's phase 2: train new scenes from photos with [Brush](https://github.com/ArthurBrussee/brush) (Rust, Apache-2.0).

- **Input:** Brush trains from COLMAP or Nerfstudio datasets (photos plus camera positions).
- **Run it as its own process** (its CLI), started and stopped by the host, rather than loading it into the host. Training runs for minutes and a crash shouldn't take the app with it.
- **Live preview:** write checkpoints into the library folder. The watcher lists them, and `addToScene` in `src/editorBridge.ts` loads them into the editor as training improves.
- **Done when:** you can start, watch, and cancel a training run from the app.

## 5. Before you share it

- **Tests pass:** `bun test`, including `tests/editor-hook.test.ts`.
- **Licenses reviewed:** `LICENSES_STRICT=1 bun run build` passes, or you've decided on each flagged item.
- **SuperSplat updates are deliberate:** change `SUPERSPLAT_COMMIT` in `scripts/build-editor.ts`, rebuild, run the tests, and check the 3D view by hand.
- **Built on each OS** you ship for, with `bun run desktop:build`.