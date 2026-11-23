# Animation climb, round 13 (#5185 gap 6): no clipping when bodies stand close. Kept, measured, not seen in stills.

Changed: a body gives ground when its posed bones reach into the other fighter. The sim keeps the two bodies' circles
apart (`radius + radius`), but a long body reaches well past its own circle: its snout and shoulders sat inside the
other's. The old contact stop only leaned the hips back, by at most 0.15 of the height, which is not enough for a long,
low body.

Where: `Puppet.update` in `src/beasts.ts`. After the IK solve, the bone loop measures how far the furthest bone goes
into the other's circle, along the line between them (`into`). `give` (metres) eases toward closing that gap, at most
`GIVE.most` of the body's radius, and next frame the whole body sits that far back from the other (like the
knockback's slide). Through a move it only grows, so a coil that leaves room doesn't step back in before the strike.
While a strike is live it holds, so a blow still lands on the hide.

Measured (`scratchpad probe-close.ts`: the two standing as close as the sim lets them, facing; then a heavy wind-up
into its strike). How far the striker's furthest bone is inside the other's circle:

| | idle, main | idle, now | wind-up and strike, main | now |
|---|---|---|---|---|
| Black Shuck at Wampus Cat | 0.37 m | 0.00 | 0.43 m | 0.05 m |
| Wampus Cat at Black Shuck | 0.56 m | 0.00 | 0.63 m | 0.06 m |
| Hodag at Yeti | 0.20 m | 0.00 | 0.31 m | 0.11 m |
| Rougarou at Sasquatch | 0.13 m | 0.00 | 0.20 m | 0.10 m |

The left-over 0.05-0.1 m is the strike's own reach landing on the other (kept on purpose).

The bot fights in `--combat` meet at random moments, so their stills don't show this cleanly either way; no frames are
kept for this round. A scripted close stand-off in the burst script (`scripts/burst-shots.ts`) would show it.

Test: "standing close, the black shuck keeps its body out of the wampus cat's" in `test/beasts.test.ts` (0.37 m in on main).
