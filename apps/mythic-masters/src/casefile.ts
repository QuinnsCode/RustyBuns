// The standoff's case file: the intro a keeper, a mythic or a new wild thing gets before the fight, and how loud it is.
// Two things set it. Whether you know *this* creature: one you've never met is a muffled shape you try to get on tape
// ("you don't know what that is yet"), one you've met but not bound is half-heard, and one the totem holds has a file.
// And how many the totem holds: the more you know, the more government the file gets, and then the more eldritch.
//
//   level 0  nothing on file: a name slams in, Gary asks if you're alright
//   level 1  field notes, typed in on the spot, with a CONFIRMED stamp (3 bound)
//   level 2  a case file: classification, origin, ability, an anomaly scan across the screen (8 bound)
//   level 3  eyes only: the file glitches and the totem starts reading it with you (16 bound)
//   level 4  protocol totem: every stamp, every scan, Gary has a cardboard badge (30 bound)
//
// No three.js and no DOM, like the director: main.ts draws `Stage.file`, plays `Stage.muffle`, and the tests read it.
import { sweepShot, type Vec3 } from "@rustybuns/util";
import type { Dossier, Scene } from "./director.ts";

/** Creatures bound to reach each level. */
export const CLEARANCE = [0, 3, 8, 16, 30] as const;
export const LEVELS = ["No file", "Field notes", "Case file", "Eyes only", "Protocol totem"] as const;
export const clearance = (bound: number) => CLEARANCE.findLastIndex((n) => bound >= n);

/** Who is being introduced, all as text so this file needs nothing from the roster. */
export interface Subject {
  id: string; name: string;
  /** The line under the name: "Keeper of Batsto Village · Lv 2". */
  sub: string;
  kind: "keeper" | "mythic" | "wild";
  /** new: never met; met: fought before, not bound; known: the totem holds one. */
  known: "new" | "met" | "known";
  /** How many creatures the totem holds. */
  bound: number;
  /** Where you stand (a trail section or the region) and the region. */
  place: string; region: string;
  tier: string; heightM: number; massKg: number;
  /** Its signature move, and where its legend comes from (a region's lore, or ""). */
  signature: string; origin: string;
}

/** A number from a string, the same every time (case numbers, which drowned noise). */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pick = <T>(xs: readonly T[], s: string) => xs[hash(s) % xs.length]!;
/** Black bars over every letter. */
export const redact = (s: string) => s.replace(/\S/g, "█");
/** The first letter of each word, the rest under bars: a name you've half caught. */
const glimpse = (s: string) => s.replace(/\S+/g, (w) => w[0] + "█".repeat(w.length - 1));

/** What you hear when you can't hear it yet. */
const DROWNED = [
  "a church organ, underwater",
  "a freight train inside a pillow",
  "somebody gargling thunder",
  "a cello falling down stairs, far away",
  "wind through a cattle grid the size of a barn",
  "a fax machine, grieving",
  "a tractor slowly sinking in a lake",
  "a choir humming through a closed door",
];
/** Lines that only start once you know enough to be scared properly. */
const GARY_FILED = [
  "Gary: Are we alright? We're in the file now. Are we in the file?",
  "Gary: Are we alright? Somebody's been taking notes on this thing for years.",
  "Gary: Are we alright? There's a coffee ring on the file. Somebody sat with this.",
];
const NARRATOR_FILED = [
  "Narrator: The government knew. The government always knew.",
  "Narrator: Filed, cross-filed, and lost in a basement in Maryland.",
  "Narrator: Officially, this did not happen. Unofficially, it is happening now.",
];

/** The case number on a file: the same creature always gets the same one. */
export const caseNo = (id: string) => `MM-${String(hash(id) % 10000).padStart(4, "0")}`;

const ROW = 0.42; // seconds between rows of the file, at most (a long file types faster)
const TYPE = 0.32; // seconds a row takes to type in
const gap = (rows: number) => Math.min(ROW, 3 / Math.max(1, rows));

/** The intro for `s`: how long, what's said, the file and the noise. The camera circles `at`. */
export function intro(s: Subject, at: Vec3, height: number, k: number): Scene {
  const level = clearance(s.bound), mythic = s.kind === "mythic";
  const lines: [number, string][] = [];
  let seconds: number, muffle = 0, name = s.name, sub = s.sub;
  let rows: string[] = [], stamps: [number, string][] = [], scans: number[] = [], glitch = 0, head = "";

  if (s.known !== "known") {
    // Early on you try to show the camera, and all you get is noise.
    const first = s.known === "new", noise = pick(DROWNED, s.id);
    seconds = s.kind === "wild" ? 3.6 : 4.8 + (mythic ? 0.8 : 0) + Math.min(level, 2) * 0.4;
    muffle = first ? 1 : 0.6;
    name = first ? redact(s.name) : glimpse(s.name);
    sub = first ? "Unidentified · you don't know what that is yet" : `${s.sub} · you still don't know what that is`;
    lines.push([0.3, first ? "Gary: Are we alright? Tell me we're alright." : "Gary: That's the one from before. Are we alright?"]);
    lines.push([1.4, first ? "You: Look! LOOK at it! Get it in the frame!" : "You: Get it on tape this time. Properly."]);
    lines.push([2.5, `???: [ drowned out: ${noise} ] · you don't know what that is yet`]);
    if (level >= 2) {
      // You know enough to have a file open, and nothing to put in it.
      head = `${caseNo(s.id)} // ${LEVELS[level]!.toUpperCase()}`;
      rows = ["SUBJECT: [REDACTED]", "CLASSIFICATION: [PENDING]", `LAST SEEN: ${s.place.toUpperCase()}`];
      stamps = [[seconds - 1.6, "UNIDENTIFIED"]];
      scans = [0.6];
    }
    if (level >= 3) lines.push([3.6, "Totem: Not yet. You are not ready to hear it."]);
    if (level >= 4) lines.push([seconds - 0.9, "Gary: It's not in the files. Why isn't it in the files."]);
  } else {
    // You know this one, and the file is as loud as everything you know.
    seconds = 3.8 + level * 0.9 + (mythic ? 1 : 0);
    head = level ? `${caseNo(s.id)} // ${LEVELS[level]!.toUpperCase()}` : "";
    lines.push([0.4, level ? pick(GARY_FILED, s.id) : "Gary: Are we alright?"]);
    lines.push([1.6, level >= 2 ? pick(NARRATOR_FILED, s.id + k) : "You: We're alright. We know this one."]);
    if (level >= 1) rows = [(s.place === s.region ? s.place : `${s.place} · ${s.region}`).toUpperCase(), `SUBJECT: ${s.name.toUpperCase()}`];
    if (level >= 2) rows.push(`CLASSIFICATION: ${s.tier.toUpperCase()}`, `HEIGHT ${s.heightM.toFixed(1)} M · MASS ${Math.round(s.massKg)} KG`, `KNOWN ABILITY: ${s.signature.toUpperCase()}`, ...(s.origin ? [`ORIGIN: ${s.origin.split(/[.;(]/)[0]!.trim().toUpperCase()}`] : []));
    if (level >= 3) rows.push("WITNESSES: 2 (UNRELIABLE, ONE IS GARY)", "OBSERVER SANITY: ████", "IT HAS SEEN THE CAMERA");
    if (level >= 4) rows.push("THREAT: YES", "CLEARANCE: YOU, SOMEHOW", "SEE ALSO: EVERY OTHER FILE");
    const done = 0.4 + rows.length * gap(rows.length);
    if (level >= 1) stamps.push([done, "CONFIRMED"]);
    if (level >= 2) { stamps.push([done + 0.35, "EYES ONLY"]); scans.push(0.5); }
    if (level >= 3) { stamps.push([done + 0.7, "MEMETIC HAZARD"]); glitch = 0.35; lines.push([2.9, "Totem: I remember this one. I remember all of them."]); }
    if (level >= 4) {
      stamps.push([done + 1, "DO NOT ENGAGE"], [done + 1.3, "ENGAGE ANYWAY"]);
      scans.push(2.2); glitch = 0.8;
      lines.push([4.1, "Gary: Agent Gary, field office: the van. I made the badge. It's cardboard."], [5.4, "Narrator: Every agency on Earth has this file. None of them have read it."]);
    }
  }
  if (mythic) lines.push([seconds - 1.2, "You: Keep rolling. Keep rolling. KEEP ROLLING."]);
  lines.sort((a, b) => a[0] - b[0]);
  // The name slams in after the file has had its moment (straight away when there's none).
  const named = head ? Math.min(seconds - 1.6, 0.4 + rows.length * gap(rows.length) + 0.2) : 0.25;
  return {
    id: "standoff", seconds, skip: true, hold: true, bars: 1, tape: s.known === "known" ? 0 : 1, freeze: 0, lines, muffle,
    label: s.known === "known" ? "" : `TAPE ? · ${s.place.toUpperCase()}`,
    title: [named, seconds - 0.5, { text: name, sub }],
    file: head ? (t) => fileAt(t, { level, head, rows, stamps, scans, glitch }) : undefined,
    shot: (t) => sweepShot(t, at, { radius: 4 + height * 1.6, height: 1 + height * 0.5, seconds, turn: mythic ? 1.4 : 0.9, start: k }),
  };
}

/** The file `t` seconds in: rows typed in one after another, stamps landed, the scan's sweep. */
function fileAt(t: number, f: { level: number; head: string; rows: string[]; stamps: [number, string][]; scans: number[]; glitch: number }): Dossier {
  const rows: string[] = [];
  f.rows.forEach((r, i) => {
    const u = (t - 0.4 - i * gap(f.rows.length)) / TYPE;
    if (u > 0) rows.push(u >= 1 ? r : r.slice(0, Math.ceil(r.length * u)));
  });
  const sweeping = f.scans.find((s0) => t >= s0 && t < s0 + 1.2);
  return { level: f.level, head: f.head, rows, stamps: f.stamps.filter(([s0]) => t >= s0).map(([, s1]) => s1), scan: sweeping === undefined ? -1 : (t - sweeping) / 1.2, glitch: f.glitch };
}
