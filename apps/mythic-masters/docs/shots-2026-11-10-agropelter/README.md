# Agropelter rebuild, 2026-11-10

The starters scored about 1.3 out of 10 next to the references (#4172). Three rebuilds were tried (PR #4177):
Cox's 1910 whip-armed ape, Tryon's 1939 squat grinner and a big-head starter. The owner picked the starter,
which is now `beasts/agropelter.json`. Comparison page: https://claude.ai/artifact/6Hi6MEPjZeS4g6hg9HnQaA

As picked, it held the branch overhead in both fists. That failed the strike test for a real reason: the arms and
branch closed a loop over the head, so the rigger found no head tip and the puppet took the branch for the head.
The face couldn't turn to a foe, and the heavy strike swung the branch. The owner chose the fix: the branch held low
across both fists, and a shaggy forelock on the crown as the head's top tip.

- [now.jpg](now.jpg): the old model
- [starter.jpg](starter.jpg): the pick, as shipped
- [starter-overhead.jpg](starter-overhead.jpg): the pick as first built, branch overhead
- [cox.jpg](cox.jpg), [tryon.jpg](tryon.jpg): the two that weren't picked

## References

- [Cox, Fearsome Creatures of the Lumberwoods (1910), p. 40](https://commons.wikimedia.org/wiki/File:Fearsome_Creatures_of_the_Lumberwoods,_with_a_Few_Desert_and_Mountain_Beasts_(page_40_crop).png)
- [Tryon, Fearsome Critters (1939)](https://commons.wikimedia.org/wiki/File:Agropelter.jpg)

## What made it better, for the next starter

- The head is round flesh from `blobs` (cranium, jutting muzzle, chin, brow) merged with `blend`, as on the Hodag.
  A `mask` node just behind the eyes, painted `face` with `snout` and `jaw`, shows the bare ape face.
- Each whip arm is a chain of a dozen nodes on a smooth curve under one `limb`, so it bends round instead of kinking at one elbow.
- The `ear` part's `width` is a radius: keep it near a third of `len`, or the ear comes out round.
- The branch is `horn`s in `bark` with a blunt `tip_base`, a splintered end and forked twigs. A plain `horn` end reads as a spear tip.
- Four hooked `horn` fingers curl round what the hand holds.
- The puppet's head is the highest tip that isn't a foot, plus the tips near it (`headOf` in `src/beasts.ts`). Keep the head
  the highest point, and give a round head something on top (a horn, a crest, a forelock), or the rig has no head tip.
  Nothing held above the head, and no closed loop of arms over it: a loop rigs differently on every rebuild.
