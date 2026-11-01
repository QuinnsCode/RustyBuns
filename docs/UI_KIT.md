# One soft, bold UI kit (#3160)

The look: big rounded tiles, one strong outline, lots of white, one accent, type readable at a glance. codeSplitter
is the reference. A style stays only where it is the game's theme (Two Fronts' war table, Delayed Reaction's neon
tunnel); the rest is drift and gets replaced.

## Done in this PR: the Controls panel

`packages/game-controls` is now headless plus a skin:

- `panel.ts` builds the cog, dialog, keys, rebinding and pad rows, and only sets `gc-*` classes.
- `skins.ts` holds the looks. `skin: "classic"` (default, unchanged for the nine games), `"house"` (the kit look,
  built on `--ui-*` tokens) or `"none"` (injects nothing; the game styles `gc-*`).
- `theme: { "--ui-accent": "#0a84ff" }` re-themes a skin without a fork; `css: "..."` appends a game's own rules.

## Tokens (`TOKENS` in `skins.ts`)

`--ui-bg --ui-ink --ui-dim --ui-line --ui-soft --ui-accent --ui-accent-soft --ui-scrim --ui-radius --ui-radius-sm --ui-border --ui-font`

## Components (next, in `packages/ui`, built on the tokens)

button, chip, dialog / bottom sheet, toast, slider, toggle, tabs, panel. Lucide icons only, icons over wrapping words.

## Inventory and migration order

Screenshots at phone and desktop size per app, each element marked thematic (keep) or drift (replace), come first
in `packages/ui`'s PR. Order by drift removed: (1) the nine games using game-controls move to `skin: "house"` or a
themed one, (2) codeSplitter's paper buttons become the first `packages/ui` customer along with the Playground,
(3) toasts and dialogs hand-rolled per app, (4) HUD bars. One issue per app, filed once the component package lands.
