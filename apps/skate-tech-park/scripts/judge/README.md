# Physics judge

Scores the skate sim against real footage and cited physics numbers, headless.

```
bun scripts/judge/score.ts [checkout] [--json]   # run from apps/skate-tech-park
bun scripts/judge/play.ts <app dir>              # raw rides: pumping, wall rides, pipe energy
```

- `score.ts` is v2 (with a `pushGrade` guard). `score.v1.ts` and `reference.v1.json` are the first scorecard, kept for comparing old scores.
- `reference.json` holds the targets. Each world is Froude-scaled by its own board length and gravity, so a kid-sized rider in the clips maps onto the giant board. Each metric says whether it is measured, cited or an estimate.
- `clips.txt` names the CC BY-SA Wikimedia Commons clips the targets were read from (links in `reference.json`).
- Tighten the scorecard when a gap shows up; never loosen it to raise a score.

Scores: main before the physics loop 53.8 (v1) / 56.5 (v2); after round 1 (#2417) 79.1 / 74.6; main at this commit 77.2 (v2).
