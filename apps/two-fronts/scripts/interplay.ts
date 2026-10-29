// Orbit-to-ground interplay: `bun scripts/interplay.ts [--seeds 300] [--wars 200]`. Two headless layers, every number seeded.
//   A. A tickets-and-posts model of one hero ground battle (not the three.js sim, but its shape: see `battle`), to compare how
//      the side holding the orbit should get its reinforcements: today's one drop, a trickle, or a trickle that starts late.
//   B. The real campaign engine, AI against AI on the short map, to see what winning an orbit buys on the ground below and
//      how the landing rules (landing.ts) bend it.
// What came out, and the recommendation: docs/INTERPLAY.md.
import { clamp, mulberry32 } from "@rustybuns/util";
import type { Faction, Side } from "../src/battle/contract.ts";
import { aiDeploys, aiOrders, aiRetreats } from "../src/war/ai.ts";
import { FACTION_NAMES } from "../src/war/galaxy.ts";
import { LANDING, type LandingRules } from "../src/war/landing.ts";
import { FACTIONS, TICKETS_PER_ARMY, declareAttacks, deployTurn, newCampaign, resolveTurn, type Campaign, type SystemState } from "../src/war/rules.ts";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1] ?? d) : d; };
const SEEDS = arg("seeds", 400), WARS = arg("wars", 200), SWEEP_SEEDS = Math.ceil(SEEDS / 2);
const SIDES: Side[] = ["attacker", "defender"];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const table = (head: string[], rows: string[][]) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => (i ? c.padStart(w[i]!) : c.padEnd(w[i]!))).join(" | ")} |`;
  console.log([line(head), `|${w.map((n, i) => (i ? "-".repeat(n + 1) + ":" : "-".repeat(n + 2))).join("|")}|`, ...rows.map(line)].join("\n"));
};

// --- A. The battle model ---
// Two sides over N posts in a line, the attacker's end first; the last post is the defender's keep, with its turrets. Each side
// fields a wave of troopers up to its cap (the sim's: 4 + 3 an army, 14 at most, the defender's garrison two more), raised
// every WAVE s out of its tickets (TICKETS_PER_ARMY an army) and WALK s from the front, so a wave that's wiped leaves a gap the
// other side walks through. Troopers kill at a rate set by how many stand on the field, with a run of luck a wave, each death
// a ticket; the front moves with the difference in numbers and swings a little on its own (a post flips as it passes). The
// side holding fewer posts bleeds the difference every BLEED s (a tie bleeds the attacker, slowly). Out of tickets and you
// lose; at the clock, more tickets wins. The attacker's edge in kills stands for its vehicles against the keep. The constants
// were set against 12 real headless battles a ratio (sim.ts, AI against AI, no assist): the attacker won 58% at 3v3 in 241 s
// on average, 17% at 2v3 (185 s), 92% at 3v2 (200 s), 0% at 2v4 (130 s), 92% at 4v2 (190 s). The model matches those within a
// few points, but overruns every post by 90 s more often than the real sim does (10% at 1:1 against 0 of 24), so its rushes
// are a stern test of a trickle. The orbit's holder gets reinforcements by one of three models: today's single drop of
// min(40, 8 a ship) at half tickets, or a trickle of `rate` tickets a minute a ship in pods every POD s, `cap` in all, from
// `delay` s in, landing only while the holder still has a post to land on.
const CLOCK = 600, WAVE = 8, WALK = 20, BLEED = 4, CONTACT = 25, POD = 20, KILL = 0.045, PUSH = 0.05, SWING = 0.02, SPREAD = 0.15, FORM = 0.5, TURRET = 1.5, ATT_EDGE = 1.45;
type Reinf = { kind: "none" } | { kind: "today" } | { kind: "trickle"; rate: number; cap: number; delay: number };
interface Fight { holder: Side; armies: Record<Side, number>; ships: number; reinf: Reinf; posts: number; turrets: number }
interface Outcome { won: boolean; time: number; overrun: boolean; pods: number }

function battle(f: Fight, seed: number, trace = false): Outcome {
  const r = mulberry32(seed), foe: Side = f.holder === "attacker" ? "defender" : "attacker";
  const tk = { attacker: f.armies.attacker * TICKETS_PER_ARMY, defender: f.armies.defender * TICKETS_PER_ARMY }, start = tk[f.holder];
  const cap = { attacker: Math.min(14, 4 + 3 * f.armies.attacker), defender: Math.min(14, 4 + 3 * f.armies.defender) + 2 };
  // Each side's form for the day (the ground, who got the vehicles out, how the squads behaved), then a run of luck a wave.
  const form = { attacker: 1 + FORM * (2 * r() - 1), defender: 1 + FORM * (2 * r() - 1) };
  const field = { attacker: 0, defender: 0 }, luck = { ...form }, coming: { side: Side; at: number; n: number }[] = [];
  const held = (s: Side) => (s === "attacker" ? Math.round(front) : f.posts - Math.round(front));
  let front = Math.floor(f.posts / 2), swing = 0, dropped = false, pods = 0, overrun = false, t = 0;
  for (const s of SIDES) coming.push({ side: s, at: CONTACT, n: Math.min(cap[s], tk[s]) });
  for (t = 1; t <= CLOCK && tk.attacker > 0 && tk.defender > 0; t++) {
    if (t % WAVE === 0) for (const s of SIDES) {
      const n = Math.min(cap[s] - field[s] - coming.filter((w) => w.side === s).reduce((a, w) => a + w.n, 0), tk[s]);
      if (n > 0) coming.push({ side: s, at: t + WALK, n });
      luck[s] = form[s] * (0.5 + r()); swing = (r() - 0.5) * 2 * SWING;
    }
    for (let i = coming.length - 1; i >= 0; i--) if (coming[i]!.at <= t) { field[coming[i]!.side] += coming[i]!.n; coming.splice(i, 1); }
    if (t > CONTACT) {
      const tur = front > f.posts - 1.5 ? f.turrets * TURRET : 0; // the keep's guns, once the fight is at the keep
      // Each side's weight at the front: a side holding more posts has more of its troops spread out garrisoning them.
      const thin = (s: Side) => 1 - SPREAD * Math.max(0, held(s) - 1);
      const sa = field.attacker * ATT_EDGE * thin("attacker") * luck.attacker, sd = (field.defender + tur) * thin("defender") * luck.defender;
      const hitD = Math.min(field.defender, KILL * sa), hitA = Math.min(field.attacker, KILL * sd);
      field.defender -= hitD; tk.defender -= hitD;
      field.attacker -= hitA; tk.attacker -= hitA;
      front = clamp(front + (PUSH * (sa - sd)) / Math.max(1, sa + sd) + swing, 0, f.posts);
    }
    if (t % BLEED === 0) {
      const d = held("attacker") - held("defender");
      if (d) tk[d > 0 ? "defender" : "attacker"] -= Math.abs(d); else if (t % (2 * BLEED) === 0) tk.attacker--;
    }
    if (t <= 90 && held(foe) === f.posts) overrun = true;
    if (trace && t % 20 === 0) console.log(`${t}s front ${front.toFixed(2)} field ${field.attacker.toFixed(1)}/${field.defender.toFixed(1)} tickets ${tk.attacker.toFixed(0)}/${tk.defender.toFixed(0)} pods ${pods}`);
    const m = f.reinf;
    if (m.kind === "today" && !dropped && tk[f.holder] <= start / 2) { dropped = true; pods = Math.min(40, f.ships * 8); tk[f.holder] += pods; }
    if (m.kind === "trickle" && t >= m.delay && (t - m.delay) % POD === 0 && held(f.holder) > 0) {
      const n = Math.max(0, Math.min(m.cap - pods, (m.rate * f.ships * POD) / 60));
      tk[f.holder] += n; pods += n;
    }
  }
  const winner: Side = tk.attacker <= 0 ? "defender" : tk.defender <= 0 ? "attacker" : tk.attacker > tk.defender ? "attacker" : "defender";
  return { won: winner === f.holder, time: Math.min(t, CLOCK), overrun, pods };
}

// `--trace A D [R T D]`: one battle, A attacker armies against D defender armies, printed every 20 s; the attacker holds the
// orbit with 2 ships and the trickle given, or no orbit.
if (process.argv.includes("--trace")) {
  const i = process.argv.indexOf("--trace"), n = (k: number) => Number(process.argv[i + k]), armies = { attacker: n(1) || 3, defender: n(2) || 3 };
  const reinf: Reinf = process.argv[i + 3] ? { kind: "trickle", rate: n(3), cap: n(4), delay: n(5) } : { kind: "none" };
  console.log(battle({ holder: "attacker", armies, ships: 2, reinf, posts: 4, turrets: 1 }, arg("seed", 1000), true));
  process.exit(0);
}

// A cell: one fight shape over the seeds, on a mix of fields (four posts and one turret mostly, some five, some two turrets).
interface Cell { win: number; overrun: number; rushWin: number; time: number; pods: number; n: number; rushes: number }
function cell(f: Omit<Fight, "posts" | "turrets">, seeds = SEEDS): Cell {
  const c: Cell = { win: 0, overrun: 0, rushWin: 0, time: 0, pods: 0, n: seeds, rushes: 0 };
  for (let i = 0; i < seeds; i++) {
    const o = battle({ ...f, posts: i % 3 ? 4 : 5, turrets: i % 4 ? 1 : 2 }, 1000 + i);
    c.win += o.won ? 1 : 0; c.time += o.time; c.pods += o.pods;
    if (o.overrun) { c.rushes++; c.rushWin += o.won ? 0 : 1; }
  }
  c.win /= seeds; c.time /= seeds; c.pods /= seeds; c.overrun = c.rushes / seeds; c.rushWin = c.rushes ? c.rushWin / c.rushes : NaN;
  return c;
}
const sum = (cs: Cell[]): Cell => {
  const t = cs.reduce((a, c) => ({ win: a.win + c.win * c.n, overrun: 0, rushWin: a.rushWin + (c.rushes ? c.rushWin * c.rushes : 0), time: a.time + c.time * c.n, pods: a.pods + c.pods * c.n, n: a.n + c.n, rushes: a.rushes + c.rushes }), { win: 0, overrun: 0, rushWin: 0, time: 0, pods: 0, n: 0, rushes: 0 });
  return { ...t, win: t.win / t.n, time: t.time / t.n, pods: t.pods / t.n, overrun: t.rushes / t.n, rushWin: t.rushes ? t.rushWin / t.rushes : NaN };
};
// Holder's armies against the enemy's, at the odds the brief asks about.
const RATIOS: [string, number, number][] = [["1:1", 3, 3], ["2:3", 2, 3], ["3:2", 3, 2], ["1:2", 2, 4], ["2:1", 4, 2]];
const fight = (holder: Side, [, mine, theirs]: [string, number, number], ships: number, reinf: Reinf): Omit<Fight, "posts" | "turrets"> =>
  ({ holder, ships, reinf, armies: holder === "attacker" ? { attacker: mine, defender: theirs } : { attacker: theirs, defender: mine } });
const both = (ratio: [string, number, number], ships: number, reinf: Reinf, seeds = SEEDS) => SIDES.map((h) => cell(fight(h, ratio, ships, reinf), seeds));

const t0 = performance.now();
console.log(`# A. One ground battle: the orbit holder's reinforcements (${SEEDS} seeds a cell)\n`);
// Calibration first: no orbit, so the model's own shape is on the table.
const base = RATIOS.map((r) => both(r, 0, { kind: "none" }));
table(["no orbit, holder:enemy", "wins as attacker", "wins as defender", "overrun by 90 s", "length"], RATIOS.map(([k], i) => [k, pct(base[i]![0]!.win), pct(base[i]![1]!.win), pct(sum(base[i]!).overrun), `${Math.round(sum(base[i]!).time)} s`]));

// The sweep: every rate, cap and delay at two and three ships, scored against the owner's targets: the orbit worth about
// 70% at even odds (felt, not a lock), about 75 tickets landed over a battle, and an even enemy that takes every post by
// 90 s still winning most of the time. Ties go to the longer delay (a rush gets its window for free) and the lower rate.
const RATES = [5, 10, 15, 20], CAPS = [50, 75, 100, 150], DELAYS = [0, 30, 60, 90];
interface Scored { reinf: Extract<Reinf, { kind: "trickle" }>; even: number; pods: number; rush: number; score: number }
const scored: Scored[] = [];
for (const rate of RATES) for (const cap of CAPS) for (const delay of DELAYS) {
  const reinf: Reinf = { kind: "trickle", rate, cap, delay }, cells: Cell[] = [], evens: Cell[] = [];
  for (const ships of [2, 3]) for (const r of RATIOS) { const cs = both(r, ships, reinf, SWEEP_SEEDS); cells.push(...cs); if (r[0] === "1:1") evens.push(...cs); }
  const all = sum(cells), even = sum(evens), rush = Number.isNaN(even.rushWin) ? 1 : even.rushWin;
  const score = Math.abs(even.win - 0.7) + Math.max(0, 0.6 - rush) + Math.abs(all.pods - 75) / 250 + rate / 1e4 - delay / 1e5;
  scored.push({ reinf, even: even.win, pods: all.pods, rush, score });
}
scored.sort((a, b) => a.score - b.score);
console.log("\n## The sweep's best (R a minute a ship, T cap, D delay; at 2-3 ships, every ratio)\n");
table(["R / T / D", "wins at 1:1", "tickets landed", "rush at 1:1 still wins", "score"], scored.slice(0, 8).map((s) => [`${s.reinf.rate} / ${s.reinf.cap} / ${s.reinf.delay}`, pct(s.even), String(Math.round(s.pods)), pct(s.rush), s.score.toFixed(3)]));
const best = scored[0]!.reinf, bestNow: Reinf = { ...best, delay: 0 };

// Table 1: the models side by side at two ships, the fleet that usually wins a contested sky.
const MODELS: [string, Reinf][] = [["none", { kind: "none" }], ["today", { kind: "today" }], [`trickle ${best.rate}/${best.cap}/0`, bestNow], [`trickle ${best.rate}/${best.cap}/${best.delay}`, best], ["trickle 20/150/0", { kind: "trickle", rate: 20, cap: 150, delay: 0 }]];
console.log("\n## Holder's win rate by model, 2 ships\n");
const t1: string[][] = [];
for (const r of RATIOS) for (const h of SIDES) t1.push([`${r[0]} as ${h}`, ...MODELS.map(([, m]) => pct(cell(fight(h, r, 2, m)).win))]);
table(["holder:enemy, role", ...MODELS.map(([k]) => k)], t1);

// Table 2: ships, today against the pick, and a cap that grows with the fleet (an army's worth a ship, three ships the most).
console.log("\n## Ships over the world: today's drop against the trickle (overrun and rush at 1:1)\n");
const t2: string[][] = [];
const variants: [string, (ships: number) => Reinf][] = [["today", () => ({ kind: "today" })], [`trickle ${best.rate}/${best.cap}/${best.delay}`, () => best], [`trickle ${best.rate}/50 a ship/${best.delay}`, (ships) => ({ ...best, cap: Math.min(150, 50 * ships) })]];
for (const [k, of] of variants) for (const ships of [1, 2, 3, 5]) {
  const m = of(ships), even = both(RATIOS[0]!, ships, m), down = both(RATIOS[1]!, ships, m), e = sum(even), all = sum([...even, ...down, ...both(RATIOS[3]!, ships, m)]);
  t2.push([`${k}, ${ships} ship${ships > 1 ? "s" : ""}`, pct(even[0]!.win), pct(even[1]!.win), pct(down[0]!.win), pct(down[1]!.win), String(Math.round(all.pods)), pct(e.overrun), Number.isNaN(e.rushWin) ? "-" : pct(e.rushWin)]);
}
table(["model, ships", "1:1 att", "1:1 def", "2:3 att", "2:3 def", "tickets landed", "overrun", "rush wins"], t2);

// Table 3: rate against cap at the pick's delay, two ships: wins at 1:1 over how often a rush (at 1:2) still wins.
console.log(`\n## Rate x cap at D=${best.delay}, 2 ships, at 1:1: holder wins / tickets landed / a rush still wins\n`);
table(["R \\ T", ...CAPS.map(String)], RATES.map((rate) => [String(rate), ...CAPS.map((cap) => {
  const e = sum(both(RATIOS[0]!, 2, { kind: "trickle", rate, cap, delay: best.delay }));
  return `${pct(e.win)} / ${Math.round(e.pods)} / ${Number.isNaN(e.rushWin) ? "-" : pct(e.rushWin)}`;
})]));

// Table 4: the delay.
console.log(`\n## Delay before the first pods, R=${best.rate} T=${best.cap}, 2 ships (overrun, rush and length at 1:1)\n`);
table(["D", "1:1 att", "1:1 def", "1:2 att", "1:2 def", "overrun", "rush wins", "length"], DELAYS.map((delay) => {
  const m: Reinf = { kind: "trickle", rate: best.rate, cap: best.cap, delay }, even = both(RATIOS[0]!, 2, m), down = both(RATIOS[3]!, 2, m), e = sum(even);
  return [`${delay} s`, pct(even[0]!.win), pct(even[1]!.win), pct(down[0]!.win), pct(down[1]!.win), pct(e.overrun), Number.isNaN(e.rushWin) ? "-" : pct(e.rushWin), `${Math.round(e.time)} s`];
}));
console.log(`\n(layer A: ${((performance.now() - t0) / 1000).toFixed(1)} s)`);

// --- B. The campaign ---
// AI against AI on the short map, with the engine as the table runs it: orders, declared attacks, the AI's retreats, the turn,
// the AI's deploys. An "orbit win" is a sky changing hands (or an empty one taken) over a world where the enemy still holds
// ground; it "lands" if the new holder owns a sector there it didn't at the start of that turn, by the end of the next turn.
// The snowball is the first space battle over Kessa or Lumen (the Narrows, where the fronts meet): does its loser lose the war?
interface War { turns: number; winner: Faction | null; orbitWins: number; landed: number; narrowsLoser: Faction | null; turnedBack: number }
const owned = (s: SystemState, f: Faction) => s.sectors.filter((x) => x.owner === f).length;
const narrows = /^Space battle over (Kessa|Lumen): (Thunder Marines|Wooka) holds/;
function war(seed: number, landing: LandingRules | undefined, maxTurns = 40): War {
  let c: Campaign = { ...newCampaign(seed, "marines", "short"), ...(landing && { landing }) };
  const w: War = { turns: 0, winner: null, orbitWins: 0, landed: 0, narrowsLoser: null, turnedBack: 0 };
  const open: { system: string; f: Faction; had: number; turn: number }[] = [];
  while (w.turns < maxTurns && !c.winner) {
    const before = c, all = FACTIONS.map((f) => aiOrders(c, f));
    c = { ...c, attacks: declareAttacks(c, all) };
    for (const o of all) o.retreats = aiRetreats(c, o);
    c = resolveTurn(c, all);
    if (c.deploying) c = deployTurn(c, c.deploying.map((f) => ({ faction: f, orders: [], deploys: aiDeploys(c, f) })));
    w.turns++;
    for (const s of Object.values(c.systems)) {
      if (!s.orbit || s.orbit === before.systems[s.id]!.orbit || !s.sectors.some((x) => x.owner !== s.orbit)) continue;
      w.orbitWins++;
      open.push({ system: s.id, f: s.orbit, had: owned(before.systems[s.id]!, s.orbit), turn: w.turns });
    }
    for (let i = open.length - 1; i >= 0; i--) {
      const o = open[i]!;
      if (owned(c.systems[o.system]!, o.f) > o.had) { w.landed++; open.splice(i, 1); } else if (w.turns > o.turn) open.splice(i, 1);
    }
    for (const l of c.log) {
      const m = narrows.exec(l);
      if (m && !w.narrowsLoser) w.narrowsLoser = FACTIONS.find((f) => FACTION_NAMES[f] !== m[2])!;
      if (l.includes("turned back")) w.turnedBack++;
    }
  }
  w.winner = c.winner;
  return w;
}
// Today's skies and five others: looser (landings get through more), tighter (the orbit shuts them out faster), a front
// that's always wide under your own orbit, one that never is, and a sky one enemy ship seals.
const SKIES: [string, LandingRules | undefined][] = [
  ["today 3/4/3/2", undefined],
  ["open 2/6/4/3", { wideOrbit: 2, openSky: 6, sealedBy: 4, siegeTurns: 3 }],
  ["tight 4/2/2/1", { wideOrbit: 4, openSky: 2, sealedBy: 2, siegeTurns: 1 }],
  ["always wide 1/4/3/2", { ...LANDING, wideOrbit: 1 }],
  ["never wide 99/4/3/2", { ...LANDING, wideOrbit: 99 }],
  ["one ship seals 3/4/1/2", { ...LANDING, sealedBy: 1 }],
];
const t1b = performance.now();
console.log(`\n# B. The campaign: AI against AI on the short map, ${WARS} wars a setting, up to 40 turns (WIDE_ORBIT/OPEN_SKY/SEALED_BY/SIEGE_TURNS)\n`);
table(["skies", "turns", "Marines win", "orbit wins a war", "landed by next turn", "Narrows fought", "its loser loses", "turned back a war"], SKIES.map(([k, landing]) => {
  const ws = Array.from({ length: WARS }, (_, i) => war(1 + i, landing)), done = ws.filter((w) => w.winner), fought = done.filter((w) => w.narrowsLoser);
  const mean = (f: (w: War) => number) => ws.reduce((n, w) => n + f(w), 0) / ws.length;
  const orbitWins = ws.reduce((n, w) => n + w.orbitWins, 0), landed = ws.reduce((n, w) => n + w.landed, 0);
  if (done.length < ws.length) console.log(`(${ws.length - done.length} of ${ws.length} wars still going at 40 turns)`);
  return [k, mean((w) => w.turns).toFixed(1), pct(done.filter((w) => w.winner === "marines").length / Math.max(1, done.length)), mean((w) => w.orbitWins).toFixed(1), pct(orbitWins ? landed / orbitWins : 0), pct(fought.length / Math.max(1, done.length)), pct(fought.length ? fought.filter((w) => w.winner !== w.narrowsLoser).length / fought.length : 0), mean((w) => w.turnedBack).toFixed(1)];
}));
console.log(`\n(layer B: ${((performance.now() - t1b) / 1000).toFixed(1)} s; whole run ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
