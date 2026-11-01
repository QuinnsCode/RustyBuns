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

## Components: `packages/ui`

Tokens (`TOKENS`, `applyTheme`), one stylesheet (`installUi`, every colour a token) and DOM factories: `button`, `chip`,
`toggle`, `slider`, `tabs`, `panel`, `dialog` (card on desktop, bottom sheet on a phone), `toast`. Icons are passed in
(lucide), never emojis. `game-controls` takes its tokens from here.

## Inventory and migration order

`bun scripts/ui-inventory.ts` counts hand-rolled button rules, dialogs, toasts, distinct colour literals and emojis
per app; the table is in [UI_INVENTORY.md](UI_INVENTORY.md). By that count codeSplitter (85 button rules, 215 toast
mentions, 159 colours), agent-office (322 emojis, most of them the icon mapping table, which #3183 stopped counting), two-fronts, park-hide-seek and eqosys drift most. Screenshots and the
thematic-or-drift call per element are made in each app's migration issue. Order: (1) the nine games on game-controls
move to `skin: "house"` or a theme, (2) Playground paper buttons, then codeSplitter, as the first `packages/ui` customers,
(3) agent-office emojis to lucide (done at runtime in #339), (4) per-app dialogs, toasts and HUD bars.
