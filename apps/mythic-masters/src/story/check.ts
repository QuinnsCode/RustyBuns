// Checks the story bible against the game (docs/STORY.md): every anchor names a real place, every `needs` a real beat,
// no loop, no sacred being fought, a built beat pinned to something the game plays, levels that only climb along the
// main story, and every playable region with all four kinds of beat and every sense of its world. It also scores the
// story card of the story-and-world climb. No DOM.
import { sectionLevel, SECTIONS, sections } from "../journey.ts";
import { REGIONS, sacredIds } from "../regions.ts";
import { ROSTER } from "../roster.ts";
import { FACTION } from "../factions/engine.ts";
import { BELIEVERS } from "../believers.ts";
import { POCKETS } from "../pockets.ts";
import { HUNTS } from "../world/hunts.ts";
import { KINDS, Story, WANTS, type Kind, type Placed, type Story as StoryT } from "./model.ts";
import { gameArcs, PLAYABLE, regionOf, roadOrder } from "./infer.ts";

export interface Where { region?: number; level?: number; label: string }

const sectionsOf = (n: number) => { const g = regionOf(n); return g ? sections(g).map((s) => s.name) : []; };

/** What an anchor names: its region, its level when it has one, and a label for the map. Undefined: no such thing. */
export function resolve(at: string): Where | undefined {
  const [kind, rest = ""] = at.split(/:(.*)/s);
  const nums = rest.split(":").map(Number);
  switch (kind) {
    case "region": { const g = REGIONS.find((r) => r.id === rest); return g && { region: g.n, label: g.name }; }
    case "section": {
      const [n = 0, k = -1] = nums, name = sectionsOf(n)[k];
      return name ? { region: n, level: sectionLevel(n, k), label: `${regionOf(n)!.name}: ${name}` } : undefined;
    }
    case "mythic": {
      const n = nums[0]!, g = regionOf(n);
      return g?.tier === "playable" ? { region: n, level: sectionLevel(n, SECTIONS - 1), label: `${g.name}: ${sectionsOf(n)[SECTIONS - 1]}` } : undefined;
    }
    case "stage": {
      const f = rest.split(".")[0], s = FACTION[f as keyof typeof FACTION]?.quest.find((q) => q.id === rest);
      return s && { region: s.n, level: sectionLevel(s.n, s.k), label: `${FACTION[f as keyof typeof FACTION].short}: ${s.title}` };
    }
    case "board": {
      const [n, k] = nums, h = [...HUNTS.values()].find((x) => x.n === n && x.k === k);
      return h && { region: h.n, level: h.level, label: h.title };
    }
    case "believers": { const b = BELIEVERS.groups.find((x) => x.id === rest); return b && { region: b.n, label: b.name }; }
    case "lair": { const p = POCKETS[rest]; const g = p && REGIONS.find((r) => r.id === p.region); return g && { region: g.n, label: p.name }; }
  }
  return undefined;
}

export interface Report {
  story: StoryT | null;
  /** Every beat: the game's and the JSON's. */
  beats: Placed[];
  arcs: { id: string; kind: Kind; title: string; pitch: string; game: boolean }[];
  problems: string[];
  /** Not wrong, worth a look: levels that drop along a thread. */
  notes: string[];
  /** Where the game disagrees with itself (a faction step a region the road reaches later): an issue for the game, not the JSON. */
  clashes: string[];
  /** Per playable region: beats of each kind. */
  coverage: { region: number; name: string; counts: Record<Kind, number> }[];
  card: { id: string; what: string; rate: number; points: number }[];
  score: number;
}

const ROSTER_IDS = new Set(ROSTER.map((c) => c.id));

export function checkStory(json: unknown): Report {
  const problems: string[] = [];
  let story: StoryT | null = null;
  try { story = Story(json); } catch (e) { problems.push(`content/story.json: ${(e as Error).message}`); }
  const game = gameArcs();
  const arcs = [...game.map((a) => ({ id: a.id, kind: a.kind, title: a.title, pitch: a.pitch, game: true })),
    ...(story?.arcs ?? []).map((a) => ({ id: a.id, kind: a.kind, title: a.title, pitch: a.pitch, game: false }))];
  const beats: Placed[] = [...game.flatMap((a) => a.beats), ...(story?.arcs ?? []).flatMap((a) => a.beats.map((b) => ({ ...b, arc: a.id, kind: a.kind })))];

  const seenArc = new Set<string>();
  for (const a of arcs) { if (seenArc.has(a.id)) problems.push(`arc ${a.id}: the id is used twice`); seenArc.add(a.id); }
  const byId = new Map<string, Placed>();
  for (const b of beats) { if (byId.has(b.id)) problems.push(`beat ${b.id}: the id is used twice`); byId.set(b.id, b); }

  const where = new Map<string, Where>();
  for (const b of beats) {
    const w = resolve(b.at);
    if (!w) problems.push(`beat ${b.id}: "${b.at}" names nothing in the game`);
    else where.set(b.id, w);
    for (const n of b.needs ?? []) if (!byId.has(n)) problems.push(`beat ${b.id}: needs "${n}", no such beat`);
    for (const f of b.fights ?? []) {
      if (sacredIds.has(f)) problems.push(`beat ${b.id}: ${f} is held sacred, never a fighter`);
      else if (!ROSTER_IDS.has(f)) problems.push(`beat ${b.id}: fights "${f}", not in the roster`);
    }
    if (b.kind === "unlock" && !b.opens) problems.push(`beat ${b.id}: an unlock beat says what it opens`);
    if (b.status === "built" && !b.game && b.at.startsWith("region:")) problems.push(`beat ${b.id}: built, so pin it to the place that plays it (not a whole region)`);
    if (/\bwizard/i.test(b.text + b.title)) problems.push(`beat ${b.id}: there is no wizard; the Book is the voice`);
  }

  // no loops in `needs`
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { problems.push(`needs loop: ${[...path, id].join(" -> ")}`); return; }
    state.set(id, 1);
    for (const n of byId.get(id)?.needs ?? []) if (byId.has(n)) visit(n, [...path, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);

  // the road: a beat never needs one from a region further down the road, and a main arc walks the road in order.
  // Levels follow the road too, but that is the levels climb's (#5382) to settle, so a level that drops is a note.
  const road = roadOrder().map((o) => o.n), step = (id: string) => { const r = where.get(id)?.region; return r === undefined ? -1 : road.indexOf(r); };
  const notes: string[] = [], clashes: string[] = [];
  for (const b of beats) for (const n of b.needs ?? []) {
    if (step(n) > step(b.id) && step(b.id) >= 0) (b.game ? clashes : problems).push(`beat ${b.id} needs ${n}, which is further down the road`);
    const a = where.get(b.id)?.level, c = where.get(n)?.level;
    if (a !== undefined && c !== undefined && c > a) notes.push(`${b.id} (level ${a}) comes after ${n} (level ${c})`);
  }
  for (const a of story?.arcs ?? []) if (a.kind === "main") {
    let last = 0;
    for (const b of a.beats) { const s = step(b.id); if (s >= 0) { if (s < last) problems.push(`main arc ${a.id}: ${b.id} goes back down the road`); last = Math.max(last, s); } }
  }

  // every playable region: all four kinds, and an area with every sense
  const coverage = PLAYABLE.map((g) => {
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
    for (const b of beats) if (where.get(b.id)?.region === g.n) counts[b.kind]++;
    return { region: g.n, name: g.name, counts };
  });
  const areas = story?.areas ?? [];
  for (const a of areas) {
    if (!REGIONS.some((r) => r.id === a.region)) problems.push(`area ${a.region}: no such region`);
    for (const w of a.world) if (w.at && !resolve(w.at)) problems.push(`area ${a.region}: "${w.at}" names nothing in the game`);
  }

  // the story card (5 points): S1 every kind everywhere, S2 every sense everywhere, S3 woven, S4 beats built, S5 world built
  const need: Record<Kind, number> = { main: 1, sub: 2, side: 3, unlock: 1 };
  const s1 = coverage.reduce((s, c) => s + KINDS.filter((k) => c.counts[k] >= need[k]).length, 0) / (coverage.length * KINDS.length);
  const s2 = PLAYABLE.reduce((s, g) => { const a = areas.find((x) => x.region === g.id); return s + (a ? WANTS.filter((k) => a.world.some((w) => w.kind === k)).length : 0); }, 0) / (PLAYABLE.length * WANTS.length);
  const written = beats.filter((b) => !b.game);
  const woven = written.filter((b) => (b.needs ?? []).some((n) => byId.get(n) && byId.get(n)!.arc !== b.arc)).length;
  const s3 = Math.min(1, written.length ? woven / written.length / 0.4 : 0);
  const s4 = written.length ? written.filter((b) => b.status === "built").length / written.length : 0;
  const wants = areas.flatMap((a) => a.world);
  const s5 = wants.length ? wants.filter((w) => w.status === "built").length / wants.length : 0;
  const card = [
    { id: "S1", what: `every playable region has ${KINDS.map((k) => `${need[k]} ${k}`).join(", ")}`, rate: s1 },
    { id: "S2", what: `every playable region's world names all ${WANTS.length} senses (${WANTS.join(", ")})`, rate: s2 },
    { id: "S3", what: "written beats tied to another arc (40% is full marks)", rate: s3 },
    { id: "S4", what: "written beats the game plays (built)", rate: s4 },
    { id: "S5", what: "world wants the game has (built)", rate: s5 },
  ].map((c) => ({ ...c, points: problems.length ? 0 : Math.round(c.rate * 100) / 100 }));
  const score = Math.round(card.reduce((s, c) => s + c.points, 0) * 100) / 100;
  return { story, beats, arcs, problems, notes, clashes, coverage, card, score };
}
