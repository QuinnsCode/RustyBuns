# Qollab Studio (apps/fm-daw) playthrough UI list: one PR

Working list; becomes the PR body, file is not committed.

1. [built] Top tab bar sits under the iPhone notch: now below the safe area, and folds to one pill (the room you're in,
   with a chevron) while you play; tap it to open the row. `src/way.ts`, `src/studio/main.ts`.
2. [built] Menu panel uses the screen: up to 1240px wide on desktop, edge to edge on a phone upright, wide on a phone on
   its side; sits under the tab bar instead of behind it. `src/studio/door.css`.
3. [built] Paused, the camera slowly circles you (a lap in 50 s, comes in off walls); unpausing flies back into first or
   third person over 0.9 s. `orbitPose` / `blendShot` in `src/studio/jam.ts`, `view()` in `src/studio/main.ts`.

Tests: test/jam-menu.test.ts (laptop, phone, phone on its side: width, under the bar, fold), test/world.test.ts (orbit lap stays in the room).
