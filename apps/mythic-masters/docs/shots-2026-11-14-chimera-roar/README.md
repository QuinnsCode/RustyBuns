# Chimera roar, 2026-11-14

Round 9 of the beast models climb (#4484). Round 8 ([shots-2026-11-14-chimera-crouch](../shots-2026-11-14-chimera-crouch/README.md)) gave the Chimera a crouch that read only a little, with a button nose over a small red block for a mouth.

- [before-close.jpg](before-close.jpg): main (round 8)
- [after-close.jpg](after-close.jpg): this round

## What changed

`hound()` in `proposals/set-a/make.ts`:

- `pose` takes an optional third value: out, sideways from the body. The Chimera uses it to splay its forelegs wide.
- `nose`: the nose's size. Above 1 it also gets two side lobes, so it reads as a broad lion's pad, not a button.
- `wrinkles`: rows of snarl creases across the top of the muzzle, placed on the muzzle's own skin.
- The gullet sphere is capped at 0.07 of the head, so a wide gape doesn't blow it up into a ball.

The Chimera:

- It crouches much lower. The chest drops 0.18 (it was 0.1), and the forelegs reach 0.4 forward and 0.1 out, with the elbows bent out.
- The roaring face has a broader, longer muzzle (`snout` 1.6, `muzzle` 0.68). The jaw hangs wide open (`gape` 2), with long fangs. The mouth is a dark red in place of a glowing orange-red, and the nose is broad, with 3 rows of wrinkles.
- The body is leaner. The haunch is slimmed, with a hard thigh muscle on each side. There are three ribs on each side of the chest and a ridge of five knuckles down the spine.
- 8669 triangles, feet 4/4, 31 joints. The `beasts.test.ts` suite passes (105).

## Scores

- Paired judge, out of 10: BEFORE 4.5 to NOW 5, verdict "better". On the climb that is half the gain (+0.25).
- Trait judge against the references: 4/10 (no change). The ribs and spine ridge don't read yet under the fur.

## Next (the judges' top gap)

- The lion still stands too tall on stiff, straight legs, with a level, sagging barrel body. The bronze has a low front, spread forelegs and a raised rump.
- The mane is a flat ring of shards that hides the head and neck. The face reads as a small mask on a pinecone.
