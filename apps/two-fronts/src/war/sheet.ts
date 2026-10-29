// The bottom sheet: the one job of the phase on screen, in a title and a line, and the one big
// button that moves the turn on, with the chip that says who the turn waits on. Every state a seat
// can be in has one, waiting included. See docs/mockups/a-banner-stepper.html and
// c-battles-and-waiting.html.
import type { Faction } from "../battle/contract.ts";
import { FACTION_NAMES, SECTOR_NAMES } from "./galaxy.ts";
import { LAST, PHASES, type PhaseNo } from "./phases.ts";
import { enemy, type Campaign } from "./rules.ts";

export type Mode = "ai" | "hotseat" | "online";
export interface SheetIn {
  c: Campaign; me: Faction; phase: PhaseNo; waiting: Faction[]; mode: Mode;
  busy?: boolean;
  fleetChosen?: boolean; // before the war: a fleet picked, to place
  selected?: string | null; // the selected world's name
  heroAt?: string | null; // where this seat's hero fights this turn, if it does
  deploys?: number; retreats?: number;
}
export interface Next { label: string; small: string; icon: string; disabled: boolean; hero: boolean }
export interface Sheet { icon: string; title: string; sub: string; live: boolean; wait: "you" | "them" | "none"; chip: string; next: Next }

// Where a hero battle under way is fought, in words.
export function heroPlace(c: Campaign) {
  const p = c.pending;
  if (!p) return "";
  return p.kind === "space" ? `${p.spec.system} orbit` : `${p.spec.system}, the ${SECTOR_NAMES[p.spec.sector].toLowerCase()}`;
}

const go = (label: string, icon = "chevrons-right", small = ""): Next => ({ label, small, icon, disabled: false, hero: false });
const held = (label: string, icon = "hourglass", small = ""): Next => ({ label, small, icon, disabled: true, hero: false });

export function sheet(x: SheetIn): Sheet {
  const { c, me, phase, waiting, mode } = x, foe = enemy(me), them = `the ${FACTION_NAMES[foe]}`;
  const hero = c.pending ? c.pending.spec.factions[c.pending.spec.hero] : null;
  const mine = !c.winner && waiting.includes(me) && (!hero || hero === me);
  const wait = c.winner || !waiting.length ? "none" : mine ? "you" : "them";
  const chip = wait === "you" ? "Waiting on you" : wait === "them" ? `Waiting on ${waiting.length > 1 ? "both sides" : `the ${FACTION_NAMES[waiting[0]!]}`}` : "";
  const out = (icon: string, title: string, sub: string, next: Next, live = false): Sheet =>
    ({ icon, title, sub, live, wait, chip, next: x.busy ? { ...next, disabled: true } : next });

  if (c.winner) return out("crown", "The war is over", `The ${FACTION_NAMES[c.winner]} won it on turn ${c.turn - 1}.`, go("New campaign", "rotate-ccw"));
  if (hero) {
    const at = heroPlace(c);
    return hero === me
      ? out("swords", `Your hero battle: ${at}`, "Fight it now. It holds the turn for both sides until it's done.", { ...go(`Fight at ${c.pending!.spec.system}`, "swords"), hero: true })
      : out("swords", `Hero battle: ${at}`, `The ${FACTION_NAMES[hero]} hero is fighting it. The other fights are settled; this one holds the turn.`, held("Hero battle", "hourglass"), true);
  }
  if (c.setup) {
    if (!mine) return out("circle-check", "Your fleet is in place", `Waiting for ${them} to place theirs.`, held("Fleet placed"));
    return x.fleetChosen
      ? out("rocket", "Place your fleet", "Everything on the front hits first; everything at the back holds out longest.", go("Deploy fleet"))
      : out("rocket", "Choose your fleet", "Pick a fleet to fight with, then place it on your worlds.", { ...go("Deploy fleet"), disabled: true });
  }
  if (c.attacks) {
    if (!mine) return out("circle-check", "Your orders are in", `${cap(them)} see where you attack, not with how many. They can pull out of a fight or call one off; then the dice roll.`, held("Orders in"));
    return out("swords", "Answer the attacks", "They see where, not how many. Pull out of a fight you'd rather skip or call yours off; hold, and the dice roll.",
      go(x.retreats ? "Confirm retreats" : "Hold everywhere"));
  }
  if (c.deploying) {
    if (!mine) return out("circle-check", "Your moves are in", `Waiting for ${them} to deploy.`, held("Moves in"));
    return out("map-pin", "Move what you took", "The fighting's over. Move troops into what you took, or up to the front.", go(x.deploys ? "Confirm moves" : "Stay put"));
  }
  if (!mine) return out("circle-check", "Your orders are in", `Waiting for ${them} to give theirs.`, held("Orders in"));
  const p = PHASES[phase - 1]!;
  if (phase === LAST) {
    const end = mode === "online" ? "Send orders" : mode === "hotseat" ? "Hand in orders" : "Next turn";
    return out(p.icon, "This turn's fights", "The dice settle each fight, or your hero fights one. Odds count what you sent against what you can see; they may have moved too.",
      x.heroAt ? { ...go(`Fight at ${x.heroAt}`, "swords"), hero: true } : go(end));
  }
  const at = x.selected;
  const title = !at ? `${p.name}: pick a world` : [`Build at ${at}`, `Place troops from ${at}`, `Send ships from ${at}`, `Land troops from ${at}`][phase - 1]!;
  return out(p.icon, title, p.say, go("Next phase", "chevrons-right", PHASES.at(phase)?.name ?? ""));
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
