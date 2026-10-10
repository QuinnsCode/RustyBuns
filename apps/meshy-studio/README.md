# Meshy Batch Studio

> **What it proves:** a desktop tool that works on your own folders and holds your API key locally, with no server of yours in between. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Put a folder of labelled concept images (or prompts) in, get game-ready `.glb` files out. The app sends them to [Meshy's API](https://docs.meshy.ai/en/api) with your own key, downloads each model as soon as it's ready, then scales it and sets the origin on your machine. Finished models can go on through texturing, remeshing, UV unwrapping, format conversion, rigging and animation, each step priced and confirmed first.

## Every Meshy endpoint it uses

| Meshy API | In the app | Credits |
|---|---|---|
| [Image to 3D](https://docs.meshy.ai/en/api/image-to-3d) | an image card | 5 to 45 by model and options |
| [Multi-Image to 3D](https://docs.meshy.ai/en/api/multi-image-to-3d) | `oak__front.png` + `oak__back.png` (1 to 4 views), or select cards → Combine | 5 to 40 |
| [Text to 3D](https://docs.meshy.ai/en/api/text-to-3d) | `oak.prompt.txt`, or Create → Text to 3D: preview, then refine | 5 to 25, + 10 or 15 to refine |
| [Retexture](https://docs.meshy.ai/en/api/retexture) | Texture (drafts, or any finished model) | 10, 15 at 8k |
| [Remesh](https://docs.meshy.ai/en/api/remesh) | step: topology, polycount, decimation, formats | 5 |
| [Resize](https://docs.meshy.ai/en/api/resize) | step: height, longest side or Meshy's guess, origin | 1 |
| [UV Unwrap](https://docs.meshy.ai/en/api/uv-unwrap) | step (up to 40,000 faces) | 5 |
| [Convert](https://docs.meshy.ai/en/api/convert) | step: glb, fbx, obj, usdz, blend, stl, 3mf | 1 |
| [Rigging](https://docs.meshy.ai/en/api/rigging) | step: humanoid skeleton + walking/running clips | 5 |
| [Animation](https://docs.meshy.ai/en/api/animation) | step: up to 10 library actions (searchable), fps / usdz / armature post-processing | 3 per action |
| [Text to Motion](https://docs.meshy.ai/en/api/text-to-motion) | step "Animate from text": prime or swift, 2 to 10 s, then applied to the rig | 10 / 3, + 3 |
| [Text to Image](https://docs.meshy.ai/en/api/text-to-image) | Create → Concept image (multi-view lands as one multi-image card) | 3 to 9 |
| [Image to Image](https://docs.meshy.ai/en/api/image-to-image) | Vary… on a card, or on up to 5 selected | 3 to 12 |
| [Balance](https://docs.meshy.ai/en/api/balance), [Usage](https://docs.meshy.ai/en/api/usage) | the credit gauge; Settings → Usage history (Studio and Enterprise plans) | free |

Images Meshy made are sent on by `input_task_id`, not uploaded again. Not used: the 3D printing endpoints (multi-color print, printability, auto split) and the Creative Lab ones, which are for printed figures rather than game assets, and webhooks, which need a public URL a desktop app doesn't have.

## The folders

Pick any folder as a workspace and the app makes these in it:

| Folder | What's in it |
|---|---|
| `000_to_be_meshyd/` | Your images. Subfolders are yours for organizing (`forest/`, `props/`), and they carry through to every stage |
| `000_to_be_meshyd/already done/` | Images Meshy has received. Nothing is ever sent twice |
| `001_has_been_meshyd/` | Meshy's `.glb`, untouched |
| `002_ready/` | The scaled copy with the origin set: the one your game uses |
| `meshy-jobs.json` | The ledger: one row per image with its Meshy task id, state and credits |
| `meshy-presets.json` | The presets. Edit them, or share the file |

Drop images on the app window, or put them straight into `000` in Finder. Drag a card onto a folder in the sidebar to move it.

## Two views

- **Folders:** a card per input with its preset, model, size and origin, grouped by the organizing folders.
- **Pipeline:** a board with Inbox → Queue → With Meshy → Ready, plus Failed. Drag Inbox → Queue to send, Queue → Inbox to pull a card back (or cancel it while Meshy still has it waiting), and Failed → Queue to retry.

## Per card: generate, or generate and texture

Each card has one switch and three choices:

```
(●  ) Generate          (  ●) Generate and
                              texture
Height [1] m   Origin bottom
Generate  Meshy 6 Lite · 5 cr
Texture   Same as generate · +10     ← only when texturing
```

- **Generate** makes the shape only: 5 credits on Meshy 6 Lite or smart topology, 20 on Meshy 7.1 or 6. Texture the keepers later with **Texture** on the card.
- **Generate and texture** shows a second picker. **Same as generate** textures in the same Meshy job, as before. Picking a Retexture model (Latest, Meshy 7, Meshy 6, Meshy 6 Lite) makes the shape untextured, then queues a Retexture step with that model by itself. It costs the same: 5 + 10 = 15 on Lite.
- The generate picker lists every model the card's endpoint takes, with the shape's price on that card. The label doesn't change height when the switch flips, so nothing on the card moves.
- The preset (from the filename prefix) is under **All settings**.

**All settings** on a card overrides any option for that card alone (each field shows the preset's value until you change it; "Reset to the preset" undoes it). Picking a model adapts what the new model can't take instead of refusing: a polycount over smart topology's 15,000 goes back to Meshy's default, a 4k or 8k texture on meshy-6-lite becomes 2k. A multi-image card whose preset uses smart topology or low poly (which that endpoint doesn't have) uses meshy-6-lite.

**Tick cards** to change many at once: one model for all of them (with the batch's total for each model), generate only on or off, a preset, Send, Texture, Steps, Combine as one multi-image model, or Vary (Image to Image).

## Steps after the shape

**Steps…** on a finished card (or on several selected) adds Meshy tasks that run in order, each on the result of the one before: Texture, Texture (refine), Remesh, Resize at Meshy, UV unwrap, Convert, Rig, Animate, Animate from text. Each shows its cost and every parameter the endpoint takes. When an endpoint doesn't take the previous task as input (Retexture after UV Unwrap, say), the app sends the model file instead. A failed step holds the ones after it until you retry it. Cancelling a waiting step drops the ones after it. Rigging needs a textured model (Meshy rigs textured humanoids), so the app asks for a texture first, counting a texture step that's queued before it.

Files land in `001` beside the model: `oak.fbx`, `oak.blend`, `oak.rigged.glb`, `oak.walking.glb`, `oak.anim-combat.glb` … Rigged and animated `.glb` files are copied to `002` (and the engine folder) too.

## The filename is the label

`<prefix>_<name>[_h<meters> | _l<meters> | _auto][_bottom | _center][_draft].png`

- `flora_oak_h12_bottom.png` uses the Flora preset, is scaled to 12 m tall with the origin at the bottom centre, and becomes `flora_oak.glb`.
- `_l0.5` sets the longest side instead of the height. `_center` puts the origin at the middle of the bounding box.
- `_auto` asks Meshy to guess the real-world height (`auto_size`, origin sent as `origin_at`), and the model is kept at Meshy's size.
- `_draft` makes an untextured shape now, to texture later (below).
- A `.txt` file with the same name holds a `texture_prompt`. A `<name>.texture.png` beside the image is a texture reference image (`texture_image_url`). Either costs Meshy 10 more credits on a textured send.

| Prefix | Meshy model | Default size | Origin | About |
|---|---|---|---|---|
| `draft_` | meshy-6-lite, no texture | 1 m tall | bottom | 5 credits |
| `item_` | smart topology, 4,000 polys | longest side 0.5 m | center | 15 credits |
| `flora_` | meshy-6-lite, 15,000 polys | 6 m tall | bottom | 15 credits |
| `environ_` | meshy-7.1, 30,000 polys, PBR | 4 m tall | bottom | 30 credits |
| `structure_` | meshy-7.1, 30,000 polys, PBR | 8 m tall | bottom | 30 credits |
| `char_` | meshy-7.1, T-pose | 1.8 m tall | bottom | 30 credits |
| anything else | Default (meshy-6-lite) | 1 m tall | bottom | 15 credits |

Each card can change its preset, size and origin before you press Send. After a model is down, changing its size, origin or name rebuilds `002` for free. Meshy is not called again.

## Watching the spend

- **Credits on the account** are always in the top bar, next to what this workspace has spent so far.
- **Every send asks first.** The confirmation itemizes the cost by preset (from [Meshy's price table](https://docs.meshy.ai/en/api/pricing)), shows the balance before and after, and how much of what's left it uses. It can be turned off in Settings.
- **A batch limit** (300 credits per send by default; 0 turns it off) and **the real balance** are checked by the backend, not just the screen: a send over either is refused. If the batch grew after you confirmed it, the send is refused too, so you never pay more than you saw.

## Draft first, texture later

Generating untextured costs 5 credits on meshy-6-lite or smart topology (20 on meshy-6 or 7.1). Texturing a finished draft with Meshy's [Retexture](https://docs.meshy.ai/en/api/retexture) costs 10 more (15 at 8k). So you can try a whole folder of ideas at 5 each and pay for texture only on the keepers.

- Switch a card to **Generate**, name the image `…_draft.png`, use the `draft_` preset, or tick **Untextured drafts** in the send confirmation (it re-prices the batch).
- A finished draft says **Untextured**. Press **Texture** on the card, **Texture N drafts** in the bar, or drag it Ready → Queue on the board. The cost is confirmed first.
- The texture is styled from the card's text prompt, else its `.texture.png`, else the concept image itself. Meshy keeps the UVs it made. The textured model replaces the draft in `001` and `002`.
- A draft that's textured later costs the same in total as texturing up front (5 + 10 = 15 on meshy-6-lite): the saving is everything you don't texture.

## Presets: every Meshy option

**Presets** in the top bar edits `meshy-presets.json` with every [Image to 3D](https://docs.meshy.ai/en/api/image-to-3d) option (the same options drive Multi-Image and Text to 3D, each endpoint taking what applies to it):

- model (Meshy 7.1, 6, 6 Lite, smart topology, and low poly until Meshy retires it on 2026-10-30), ultra geometry resolution
- texture on/off, PBR, texture resolution
- remesh, topology, target polycount, adaptive decimation, keeping the pre-remesh model
- pose, image enhancement, remove lighting
- transparent and four-view thumbnails, moderation
- extra formats (fbx, obj, usdz, stl, 3mf) downloaded into `001`, with texture maps beside them

It also covers every [Retexture](https://docs.meshy.ai/en/api/retexture) option for the texture step: model, keep UVs, PBR, resolution and remove lighting.

Anything left on "Meshy default" isn't sent, so Meshy's own default applies. The editor shows each preset's textured, draft and texture-later price as you change it. It flags what Meshy would reject (4k texture on meshy-6-lite, ultra geometry off meshy-7.1, polycount out of range) and won't save those. Settings that don't apply to the chosen model are left out of the request. Deprecated aliases (`ultra_mode`, `hd_texture`, `is_a_t_pose`, `symmetry_mode`, `art_style`, `meshy-7`) aren't offered: each has a current equivalent that is.

## What happens on Send

1. Images go to Meshy a few at a time, up to your plan's queue limit (Pro 10, Studio 20, Premium 30, Ultra 100; set it in the sidebar).
2. The task id is saved to the ledger **before** the image moves to `already done`. If you quit in the middle of a batch, nothing is lost or sent twice.
3. Cards show Meshy's progress and preview image. The `.glb` downloads as soon as the job succeeds, because Meshy's links expire.
4. The model is scaled and its origin set with [glTF-Transform](https://gltf-transform.dev), then written to `002`.
5. A failed job shows Meshy's message and a Retry button. Meshy refunds failed jobs. A job still waiting at Meshy can be cancelled for a refund, and its image goes back to `000`.
6. Out of credits (402) or a bad key (401) pauses the batch. It doesn't fail every card. A rate limit (429) waits 10 s and carries on.

## Your key

You paste it once, in a masked field, on the first screen or in Settings. It's checked with Meshy's free balance call, then saved as `~/.meshy-studio/meshy-key`, readable by your user only. It is never shown again, not even its last characters: the app only knows that a key is saved. It is never saved in the workspace or the ledger. The browser UI never sees it: only the local backend calls `api.meshy.ai`. There's no telemetry. `MESHY_API_KEY` in the environment overrides the saved key.

## Game engines

In Settings, pick an engine and a folder, and every finished model is also copied there, keeping your folders. A resize or rename copies it again, and the old name is removed. The setting is saved in the workspace as `meshy-studio.json`.

| Engine | Folder to pick | Then |
|---|---|---|
| Unity | `<project>/Assets/Meshy` | Unity imports `.glb` with the [glTFast](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@latest) package |
| Unreal | `<project>/Content/Meshy` | Unreal 5 imports `.glb` through Interchange; with Auto Reimport on, new files come in by themselves |
| Blender | any folder | Ready cards get a **Blender** button that opens the models in an empty scene (Blender found in the usual place, on `PATH`, or at `BLENDER_PATH`) |
| Any folder | a shared drive, another tool's import folder | |

## Run it

```
cd apps/meshy-studio
bun run desktop:dev          # build and open the app
bun run desktop:build        # the single file: dist/meshy-studio-<os>-<arch>
bun test                     # engine + host, against a fake Meshy (no credits spent)
```

The engine works without the app too:

```
MESHY_API_KEY=msy_... bun engine/cli.ts ~/MyGame/meshes            # list, with the credit estimate
MESHY_API_KEY=msy_... bun engine/cli.ts ~/MyGame/meshes --send     # send everything new and wait
```

**First run on macOS:** the binary is unsigned, so macOS blocks it the first time. Right-click → Open, or run `xattr -d com.apple.quarantine <file>`.

## What was checked

- `bun test`: 28 tests. They cover label parsing, the price table, the scale and origin math on a real `.glb`, and the whole send → poll → download → fit loop against a fake Meshy. They also cover a 402 pause and resume, cancel-while-pending with a refund, a Meshy failure then retry, a free re-fit, moving between folders, the key file's `0600` mode and refusing paths that escape the workspace. Also: the key never comes back out of the status route, the spend guards (confirmed amount, batch limit, balance) refusing sends in the backend, the engine folder copy (renames included), and the Blender import script with awkward paths. Also: draft and texture-later pricing, every option reaching the request body (and the ones that don't apply being dropped), the preset checks, the preset editor's save rules, extra formats and texture maps downloading into `001`, and a draft batch where only one model gets the texture step, and a card textured by a Retexture step with its own model after an untextured shape. And for the whole API: per-card models with each model's cost, overrides, bulk edits and model picks that adapt; multi-image grouping, combine and split; Text to 3D preview then refine; a step chain on one model (remesh → UV unwrap → convert → texture → rig → animate with post-processing → text to motion → animate from the clip), with each step's input checked the way Meshy checks it; a failed step holding the rest until retried; concept images from Text to Image (multi-view landing as one card, sent on by `input_task_id`) and Image to Image; and the host routes for steps, concepts, text cards, the animation library and usage (403 on plans without it).
- The Blender import, run in real Blender (headless): two finished models came in at the right sizes (12 m tall becomes 12 on Blender's Z-up axis).
- The built binary, clicked through in Chrome against the fake Meshy: a wrong key refused, a right key saved, images dropped in Finder showing up with parsed labels, a preset changed on a card, four sent, all four landing in `002_ready` (including `forest/`) at exactly the labelled sizes, a height changed afterwards with no new Meshy job, and everything still there after a restart. And after the redesign: the key masked while typing and only dots once saved, a 105-credit batch refused by a 50-credit limit in the confirmation, a card dragged Inbox → Queue, confirmed and walked through to Ready, and its model copied byte for byte into a Unity `Assets/Meshy` folder.
- The draft flow in the app against the fake Meshy: three images sent as untextured drafts (60 credits re-priced to 30), one textured with a confirmed 10 credits, its card going Untextured → Texturing → Ready, and a preset edited (meshy-7.1 → meshy-6-lite, prices updating live) and saved to `meshy-presets.json`.
- The full app after the API work, in Chrome against the fake Meshy:
  - each card's model list with prices for image, multi-image and text cards
  - four cards set to Meshy 6 Lite at once (~60), then all made drafts (~20) and sent
  - a rig step, then the animation library: search, categories, picking actions
  - a multi-view concept image landing as one multi-image card
  - the board showing every source

  Found and fixed on the way:
  - cards were clipped by long model names
  - a dialog closed when a click started inside it
  - smart topology was refused instead of adapted
  - a multi-image card kept a model its endpoint doesn't have
- **Not checked inside Unity or Unreal** (neither is installed here): only that the files land in the folder.
- **Not yet checked against the real Meshy API.** Meshy has no free test key, so the first real batch spends credits.

## Not built yet

- Rebuilding the ledger from Meshy's task list (`GET /image-to-3d`) after a crash between Meshy accepting a job and the ledger write. That window is a single file write.
- Storing the key in the OS keychain. It's a user-only file for now.
- A 3D preview on the card, and signed macOS/Windows builds.
- Engine plugins (a Unity editor window, an Unreal or Blender add-on that talks to the app). The folder copy is the whole integration for now.
- Live progress over Meshy's SSE streams: the app polls every 3 seconds instead.
- The printing endpoints, Creative Lab and webhooks (see the API table above).
