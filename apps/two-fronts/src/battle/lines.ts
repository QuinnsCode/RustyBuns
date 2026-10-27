// What the radio and the troops say on each world. The redwood forest and the jungle keep the
// ferns-and-trees lines; the other worlds drop those and add their own. Only talk: the sim's rolls
// don't change, and the shield world's pool is exactly the old one.
import type { SectorKind } from "./contract.ts";
import RADIO_SCRIPT from "../../content/radio.json";
import CHATTER_SCRIPT from "../../content/chatter.json";

const GREEN = /\b(ferns?|trees?|forest)\b/i;

// The words are in content/ (bun run cms edits them): radio.json has the shield world's pool under
// "shield" and the others' own lines beside it; chatter.json has each side's pools and, under "worlds",
// what each other world's troops say over their heads: [Thunder Marines calm, Thunder Marines scared, Wooka scared].
const RADIO: Partial<Record<SectorKind, string[]>> = RADIO_SCRIPT;
const CHAT: Partial<Record<SectorKind, { marinesCalm: string[]; marinesScared: string[]; wookaScared: string[] }>> = CHATTER_SCRIPT.worlds;

const without = (pool: readonly string[]) => pool.filter((l) => !GREEN.test(l));
const green = (k: SectorKind) => k === "shield" || k === "jungle";

// The radio's pool for a world.
export const radioFor = (k: SectorKind, all: readonly string[]): readonly string[] =>
  k === "shield" ? all : [...(green(k) ? all : without(all)), ...(RADIO[k] ?? [])];

// A side's chatter for a world: the same pools, with the green lines swapped for the world's own.
export function chatterFor<T extends { calm: readonly string[]; scared: readonly string[] }>(k: SectorKind, side: "marines" | "wooka", lines: T): T {
  if (k === "shield") return lines;
  const own = side === "marines" ? { calm: CHAT[k]?.marinesCalm, scared: CHAT[k]?.marinesScared } : { scared: CHAT[k]?.wookaScared };
  const pick = (p: "calm" | "scared") => [...(green(k) ? lines[p] : without(lines[p])), ...(own[p as keyof typeof own] ?? [])];
  return { ...lines, calm: pick("calm"), scared: pick("scared") };
}
