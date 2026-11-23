// Every word a player reads for a faction, a hull or a wing lives here, so a naming pass (DESIGN.md "Taste calls",
// T3) is one file. The sim uses the ids on the left (side, kind, role); the page shows the words on the right.
// Our own setting: a navy of wedge destroyers against a ragged frontier rising. No borrowed names.

export type Side = "navy" | "rim";
export type ShipKind = "dreadnought" | "destroyer" | "frigate" | "corvette" | "cruiser" | "carrier" | "station";
export type Role = "interceptor" | "bomber" | "escort";

export const SIDE_NAME: Record<Side, string> = { navy: "The Concord Navy", rim: "The Free Rim" };

export const SHIP_NAME: Record<ShipKind, string> = {
  dreadnought: "Sovereign-class dreadnought",
  destroyer: "Lance-class destroyer",
  frigate: "Warden interdictor",
  corvette: "Rim corvette",
  cruiser: "Bastion cruiser",
  carrier: "Hive carrier",
  station: "Orbital bastion",
};

/** A wing's craft by side: what the navy flies, and what the Rim flies in the same job. */
export const CRAFT_NAME: Record<Side, Record<Role, string>> = {
  navy: { interceptor: "Dart", bomber: "Maul", escort: "Warden" },
  rim: { interceptor: "Hornet", bomber: "Lancer", escort: "Shrike" },
};

/** Call signs, handed out in order to the wings a ship launches. */
export const WING_CALLS: Record<Side, string[]> = {
  navy: ["Ash", "Iron", "Onyx", "Cinder", "Slate", "Ember", "Basalt", "Flint", "Jet"],
  rim: ["Gold", "Rust", "Moss", "Sable", "Tallow", "Copper", "Fern", "Amber"],
};

/** The commander's two gifts, read from the focus meter: seeing their next move, and the trance over your pilots. */
export const POWER_NAME = { foresight: "Foresight", trance: "Fleet Trance" };
