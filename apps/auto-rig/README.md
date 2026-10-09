# Auto Rig

> **What it proves:** Rust where it pays: the rigger is written in Rust and in TypeScript, both give identical output, and the app falls back to TypeScript when Rust can't load. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Drop in a 3D model (a glTF/GLB, or one of the built-in samples) and get a skeleton, skin weights, and inverse kinematics you can drag around. The rigger is written twice, in Rust and in TypeScript, and both give the same answer bit for bit. The IK is [closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js) by Garrett Johnson.

## Run it

1. **Install** (repo root): `bun install`
2. `cd apps/auto-rig`
3. **Optional, for the Rust rigger** (needs [rustup](https://rustup.rs)): `bun run build:native`. Skip it and the host uses the TypeScript rigger.
4. **Launch**: `bun run desktop:dev`

`bun run dev` serves the plain browser build with hot reload (run step 4 once first; it writes `.rustybuns/vite.ts`). With no host there, rigging runs in a Web Worker.

## What it does

| Step | How |
|---|---|
| Voxelize | Rasterize every triangle into a grid, dilate once to seal small holes, flood fill the outside. Whatever the flood fill can't reach is solid. |
| Root | Distance inward from the surface. The thickest voxel (chest, pelvis, torso) becomes the root. |
| Skeleton | Geodesic distance from the root through the solid, cut into slices. Each connected piece of a slice is a node, and each node's parent is the piece in the slice below it that it touches most (a Reeb graph). Short twigs get pruned, and each limb is split into bones by arc length. |
| Weights | Geodesic voxel binding: distance through the solid from each bone to each vertex. The four nearest bones get weights of 1/(1+d)^4, normalized. |
| IK | Each joint is a ball joint, and each tip gets a position goal. Pinning the root or clasping two tips together closes a loop, which is the case closed-chain-ik handles. |

All distances are integers (10/14/17 per face, edge and corner step), so `test/parity.test.ts` can check that Rust and TypeScript return identical joints, bone assignments and weights.

## Use

- **Drag**: click a handle (orange = pinned tip, gray = free, blue cube = root), then drag the gizmo arrows. Pinned tips hold their position while the rest of the body bends to reach.
- **Free the root**: uncheck *Pin the root*. Now pulling a hand drags the whole body, and the planted feet keep it standing.
- **Clasp**: select one tip, then shift-click another. The second tip is pulled to the first, closing a loop through the body.
- **Race the engines**: the same rig, timed three ways: Rust over bun:ffi, TypeScript under Bun, and TypeScript in the page.
- **Download rigged .glb**: the skinned meshes and bones, at the normalized scale (bounding box diagonal of 2, standing on the ground).

## Testing

`bun test test` runs the rig checks on two procedural models (one tip per limb, each near where it should be; a valid tree; weights that sum to 1), the Rust/TS parity check, and the IK checks (a dragged hand reaches its goal while the other tips hold; a clasp closes; reset restores the rest pose).

## Limits

- Fingers, ears and other thin parts merge at the default 96 voxels. Raise *Voxels* to separate them.
- Any existing rig in a GLB is discarded. The model's current pose becomes the rest pose.
- Joint rotation limits are generic (±144°), not anatomical. Bones are unnamed beyond rough labels like "Tip 2 · low left".
- On these models Rust is about 3–5× faster than TypeScript. The weight pass uses one thread per bone.
