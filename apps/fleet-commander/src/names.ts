// Every word a player reads for a faction, a hull or a wing lives here, so a naming pass (DESIGN.md "Taste calls",
// T3) is one file. The sim uses the ids on the left (side, kind, role); the page shows the words on the right.
// Our own setting: a navy of wedge destroyers against a ragged frontier rising. No borrowed names.

export type Side = "navy" | "rim";
export type ShipKind = "dreadnought" | "destroyer" | "frigate" | "sensor" | "corvette" | "cruiser" | "carrier" | "station" | "bulwark" | "minelayer";
export type Role = "interceptor" | "bomber" | "escort" | "scout";

export const SIDE_NAME: Record<Side, string> = { navy: "The Directorate", rim: "The Free Worlds Compact" };

export const SHIP_NAME: Record<ShipKind, string> = {
  dreadnought: "Sovereign-class dreadnought",
  destroyer: "Lance-class destroyer",
  frigate: "Warden interdictor",
  sensor: "Argus sensor ship",
  corvette: "Compact corvette",
  cruiser: "Bastion cruiser",
  carrier: "Hive carrier",
  station: "Orbital bastion",
  bulwark: "Tidewall bulwark",
  minelayer: "Sower minelayer",
};

/** A wing's craft by side: what the navy flies, and what the Compact flies in the same job. */
export const CRAFT_NAME: Record<Side, Record<Role, string>> = {
  navy: { interceptor: "Dart", bomber: "Maul", escort: "Warden", scout: "Kite" },
  rim: { interceptor: "Hornet", bomber: "Lancer", escort: "Shrike", scout: "Moth" },
};

/** Call signs, handed out in order to the wings a ship launches. */
export const WING_CALLS: Record<Side, string[]> = {
  navy: ["Ash", "Iron", "Onyx", "Cinder", "Slate", "Ember", "Basalt", "Flint", "Jet"],
  rim: ["Gold", "Rust", "Moss", "Sable", "Tallow", "Copper", "Fern", "Amber"],
};

/** The commander's three gifts, read from the focus meter: seeing their next move, the trance over your pilots, and
 *  the voice every wing hears at once. */
export const POWER_NAME = { foresight: "Foresight", trance: "Fleet Trance", voice: "Command Voice" };
