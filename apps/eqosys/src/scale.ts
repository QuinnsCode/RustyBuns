// What Qollab's rooms cost a month as players grow, on four homes: Durable Objects (today), Rivet Cloud, Hetzner
// servers behind Cloudflare (Alchemy spawns them; the Bun shell runs the same DO classes, a router Worker sends each
// room to its server), and the same with spare servers in each region behind a Cloudflare load balancer. Prices read
// 2026-11-06 (notes/RIVET_VS_DURABLE_OBJECTS.md); the Scale tab draws them and where each one gets cheaper.
import { clamp } from "@rustybuns/util";

/** One month, in seconds. */
const MONTH = 30 * 86_400;
/** Hetzner prices are in euros. */
export const EUR_USD = 1.15;

/** The load a dashboard user dials in. */
export type Load = {
  /** Players online at once, on average over the month. */
  ccu: number;
  /** Players per room (a party, a space; a Qollab hub is a room of 1). */
  room: number;
  /** Messages each player sends a second while playing. */
  rate: number;
  /** Share of the month a room is busy (1 plays all day, a lobby is near 0). */
  awake: number;
  /** Bytes per message, for the traffic a server sends. */
  bytes: number;
  /** 1 Europe, 2 Europe and the US, 3 plus Singapore. */
  regions: number;
  /** Socket work one server vCPU keeps up with a second: a message in plus its sends out, each one unit.
   *  scripts/room-stress.ts measured 210-240k on an M1 Pro core (2026-11-06); a shared Hetzner vCPU is
   *  taken as about half that. */
  perCore: number;
  /** Memory one room holds, MB. A room of 4 measured about 1 MB on a box host (ONE_BOX below); 4 leaves room for bigger state. */
  roomMb: number;
  /** Wall-clock ms a Durable Object spends handling one incoming message (what it is billed while hibernating).
   *  The relay's own JavaScript measured 0.014-0.028 ms (scripts/room-stress.ts); workerd's per-event cost on
   *  top can't be measured off Cloudflare, so the default allows 0.1. */
  ms: number;
  /** 1: the room hibernates between messages; 0: it can not (`accept()`, a server tick loop), so it bills all day. */
  hibernate: number;
};

export const DEFAULT: Load = { ccu: 1000, room: 4, rate: 20, awake: 1, bytes: 120, regions: 2, perCore: 100_000, roomMb: 4, ms: 0.1, hibernate: 1 };

const LIMITS: Record<keyof Load, [number, number]> = {
  ccu: [1, 10_000_000], room: [1, 500], rate: [0.01, 120], awake: [0, 1], bytes: [8, 65_536],
  regions: [1, 3], perCore: [1000, 1_000_000], roomMb: [0.1, 1024], ms: [0.01, 1000], hibernate: [0, 1],
};

/** A Load from a page's query, each number clamped to what makes sense and the defaults for the rest. */
export function loadOf(q: URLSearchParams): Load {
  const out = { ...DEFAULT };
  for (const k of Object.keys(LIMITS) as (keyof Load)[]) {
    const raw = q.get(k), v = raw === null || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(v)) out[k] = clamp(v, ...LIMITS[k]);
  }
  out.regions = Math.round(out.regions);
  out.hibernate = Math.round(out.hibernate);
  return out;
}

/** What the load asks of whatever runs it. */
export function needs(l: Load) {
  const rooms = Math.ceil(l.ccu / l.room);
  const msgs = l.ccu * l.rate * MONTH * l.awake; // incoming, a month
  const tb = (msgs * Math.max(1, l.room - 1) * l.bytes) / 1e12; // fanned out, a month
  const cores = (l.ccu * l.rate * l.room) / l.perCore; // at the busy hour: one receive plus room-1 sends each
  const ramGb = (rooms * l.roomMb) / 1024;
  const connects = (l.ccu * MONTH) / 3600; // a player opens a socket about once an hour
  return { rooms, msgs, tb, cores, ramGb, connects };
}

/** Player-hours a month: players online on average, for the share of the month rooms are busy. The unit a game's
 *  own numbers come in, so a bill can be read as a price per hour played. */
export const playerHours = (l: Load) => l.ccu * (MONTH / 3600) * l.awake;

export type Cost = { usd: number; lines: [string, number][]; note: string };

const over = (used: number, free: number, per: number, unit: number) => (Math.max(0, used - free) / unit) * per;

/** Durable Objects on Workers Paid. An object is billed as 128 MB while it runs JavaScript, or all the time it is
 *  awake when it can not hibernate; one that can hibernate costs nothing between handlers, even before it sleeps. */
export function durableObjects(l: Load): Cost {
  const n = needs(l);
  const requests = n.msgs / 20 + n.connects; // incoming socket messages count 20:1
  const busy = l.hibernate ? Math.min(1, l.rate * l.room * l.ms / 1000) : 1; // share of a busy room's time in a handler
  const gbs = n.rooms * MONTH * l.awake * busy * 0.125;
  const req = over(requests, 1e6, 0.15, 1e6), dur = over(gbs, 4e5, 12.5, 1e6);
  return { usd: 5 + req + dur, lines: [["Workers Paid", 5], ["requests", req], [l.hibernate ? "handler time" : "awake all day", dur]],
    note: `${n.rooms.toLocaleString("en-US")} rooms, ${Math.round(requests / 1e6).toLocaleString("en-US")}M requests, ${Math.round(gbs / 1e3).toLocaleString("en-US")}k GB-s` };
}

type Node = { name: string; vcpu: number; gb: number; usd: number };
const R: Node[] = [
  { name: "R-5", vcpu: 0.25, gb: 1, usd: 4.2 }, { name: "R-10", vcpu: 0.5, gb: 2, usd: 8.4 }, { name: "R-20", vcpu: 1, gb: 4, usd: 16.8 },
  { name: "R-40", vcpu: 4, gb: 8, usd: 27.3 }, { name: "R-160", vcpu: 8, gb: 16, usd: 94.5 },
];
const PLANS = [
  { name: "Free", usd: 0, cap: 1, sizes: 2 }, { name: "Hobby", usd: 10, cap: 3, sizes: 3 },
  { name: "Team", usd: 120, cap: 10, sizes: 5 }, { name: "Enterprise", usd: 900, cap: 50, sizes: 5 },
];
const fit = (cores: number, gb: number, vcpu: number, ram: number) => Math.max(1, Math.ceil(cores / vcpu), Math.ceil(gb / ram));

/** Rivet Cloud: a plan for the control plane plus actor nodes, the cheapest plan and node size that fit.
 *  Past 50 nodes it is Enterprise plus your own nodes, priced here as R-160s. Egress isn't on Rivet's price page. */
export function rivetCloud(l: Load): Cost {
  const n = needs(l);
  let best: Cost | null = null;
  for (const p of PLANS) for (const s of R.slice(0, p.sizes)) {
    const count = Math.max(l.regions, fit(n.cores, n.ramGb, s.vcpu, s.gb));
    if (count > p.cap) continue;
    const usd = p.usd + count * s.usd;
    if (!best || usd < best.usd) best = { usd, lines: [[`${p.name} plan`, p.usd], [`${count} x ${s.name}`, count * s.usd]], note: `${p.name}, ${count} ${s.name} node${count > 1 ? "s" : ""}; egress not priced` };
  }
  if (best) return best;
  const big = R[4]!, count = Math.max(l.regions, fit(n.cores, n.ramGb, big.vcpu, big.gb));
  return { usd: 900 + count * big.usd, lines: [["Enterprise plan", 900], [`${count} x R-160 (your own)`, count * big.usd]], note: "past 50 nodes: bring your own" };
}

type Box = { name: string; vcpu: number; gb: number; eur: number; tb: number };
/** Hetzner shared-vCPU servers by region, EUR a month before VAT, with the traffic each includes; and the euros a TB past it. */
const HETZNER: { region: string; boxes: Box[]; perTb: number }[] = [
  { region: "Europe", perTb: 1, boxes: [
    { name: "CPX22", vcpu: 2, gb: 4, eur: 19.99, tb: 20 }, { name: "CPX32", vcpu: 4, gb: 8, eur: 35.99, tb: 20 },
    { name: "CPX42", vcpu: 8, gb: 16, eur: 69.99, tb: 20 }, { name: "CPX62", vcpu: 16, gb: 32, eur: 130.49, tb: 20 }] },
  { region: "US", perTb: 1, boxes: [
    { name: "CPX11", vcpu: 2, gb: 2, eur: 17.99, tb: 1 }, { name: "CPX31", vcpu: 4, gb: 8, eur: 62.99, tb: 3 },
    { name: "CPX41", vcpu: 8, gb: 16, eur: 120.99, tb: 4 }, { name: "CPX51", vcpu: 16, gb: 32, eur: 238.49, tb: 5 }] },
  { region: "Singapore", perTb: 7.4, boxes: [
    { name: "CPX22", vcpu: 2, gb: 4, eur: 26.99, tb: 1 }, { name: "CPX32", vcpu: 4, gb: 8, eur: 49.49, tb: 2 },
    { name: "CPX42", vcpu: 8, gb: 16, eur: 93.99, tb: 3 }, { name: "CPX62", vcpu: 16, gb: 32, eur: 172.49, tb: 5 }] },
];
/** How players split over the regions. */
const SPLIT = [[1], [0.6, 0.4], [0.5, 0.35, 0.15]];

/** Servers each region needs; `spare` adds one per region and never fewer than two (a pool that survives a box). */
function servers(l: Load, spare: boolean) {
  const n = needs(l), base = 0.5; // GB the OS and Bun take on each box
  return SPLIT[l.regions - 1]!.map((share, i) => {
    const h = HETZNER[i]!;
    let pick = { box: h.boxes[0]!, count: 0, eur: Infinity };
    for (const box of h.boxes) {
      let count = fit(n.cores * share * 1.5, n.ramGb * share + base, box.vcpu, box.gb - base); // 1.5: headroom at the busy hour
      if (spare) count = Math.max(2, count + 1);
      const traffic = over(n.tb * share, count * box.tb, h.perTb, 1);
      const eur = count * box.eur + traffic;
      if (eur < pick.eur) pick = { box, count, eur };
    }
    return { region: h.region, ...pick };
  });
}

const router = (l: Load) => 5 + over(needs(l).connects, 10e6, 0.3, 1e6); // the Worker that sends a room to its server

/** Hetzner boxes Alchemy spawns, one pool a region, behind Cloudflare: websockets proxy free, a Worker routes by room. */
export function hetzner(l: Load): Cost {
  const s = servers(l, false), r = router(l);
  const lines: [string, number][] = [["router Worker", r], ...s.map((x): [string, number] => [`${x.region}: ${x.count} x ${x.box.name}`, x.eur * EUR_USD])];
  return { usd: lines.reduce((a, [, v]) => a + v, 0), lines, note: `${s.reduce((a, x) => a + x.count, 0)} servers, no spare` };
}

/** The same with a spare in every region and a Cloudflare load balancer health-checking them ($5 for two endpoints,
 *  $5 each more: third-party figures, not on Cloudflare's own docs). */
export function hetznerHa(l: Load): Cost {
  const s = servers(l, true), r = router(l), boxes = s.reduce((a, x) => a + x.count, 0);
  const lb = 5 + 5 * Math.max(0, boxes - 2);
  const lines: [string, number][] = [["router Worker", r], ["load balancer", lb], ...s.map((x): [string, number] => [`${x.region}: ${x.count} x ${x.box.name}`, x.eur * EUR_USD])];
  return { usd: lines.reduce((a, [, v]) => a + v, 0), lines, note: `${boxes} servers, a spare in each region` };
}

export const PATHS = [
  { id: "do", name: "Durable Objects", cost: durableObjects },
  { id: "rivet", name: "Rivet Cloud", cost: rivetCloud },
  { id: "hetzner", name: "Hetzner behind Cloudflare", cost: hetzner },
  { id: "ha", name: "Hetzner, HA pools", cost: hetznerHa },
] as const;
export type PathId = (typeof PATHS)[number]["id"];

const at = (l: Load, ccu: number) => ({ ...l, ccu });
const costOf = (id: PathId, l: Load) => PATHS.find((p) => p.id === id)!.cost(l).usd;

/** Players online (log steps from 10 to 10M) and each path's cost there: the chart's lines. */
export function sweep(l: Load, steps = 61) {
  return Array.from({ length: steps }, (_, i) => {
    const ccu = Math.round(10 ** (1 + (6 * i) / (steps - 1)));
    return { ccu, usd: Object.fromEntries(PATHS.map((p) => [p.id, p.cost(at(l, ccu)).usd])) as Record<PathId, number> };
  });
}

/** The fewest players online at which `b` costs less than `a`, from 10 to 10M (or null: never in that range).
 *  Server bills step, so this walks the sweep for the first point `b` wins, then bisects back to the player. */
export function crossover(l: Load, a: PathId, b: PathId): number | null {
  const pts = sweep(l, 121);
  const i = pts.findIndex((p) => p.usd[b] < p.usd[a]);
  if (i < 0) return null;
  if (i === 0) return pts[0]!.ccu;
  let lo = pts[i - 1]!.ccu, hi = pts[i]!.ccu;
  while (hi - lo > Math.max(1, lo * 0.002)) {
    const mid = Math.round((lo + hi) / 2);
    if (costOf(b, at(l, mid)) < costOf(a, at(l, mid))) hi = mid; else lo = mid;
  }
  return hi;
}

/** Common Qollab rooms, as a Load to start from. */
export const PRESETS: { id: string; name: string; what: string; load: Partial<Load> }[] = [
  { id: "hub", name: "Hubs and chat", what: "a hub per player, a message now and then", load: { room: 1, rate: 0.05, awake: 0.05, bytes: 200 } },
  { id: "walk", name: "Walk together", what: "a party of six sharing positions", load: { room: 6, rate: 10, awake: 0.8, bytes: 80 } },
  { id: "action", name: "Action room", what: "four players at 20 inputs a second", load: { room: 4, rate: 20, awake: 1, bytes: 120 } },
  { id: "space", name: "Big space", what: "fifty in one space, five updates a second", load: { room: 50, rate: 5, awake: 1, bytes: 100 } },
];

/** Games side by side on one host, each its own box host process: MB with nobody in and with `rooms` rooms of 4
 *  players. scripts/one-box.ts on the builder Mac (darwin-arm64, Bun 1.4.3), 2026-11-09 (#4056). */
export const ONE_BOX = {
  measured: "2026-11-09", rooms: 16,
  games: [{ name: "Park Hide & Seek", idleMb: 43, busyMb: 63 }, { name: "Git Recon", idleMb: 28, busyMb: 41 }],
};

/** How many games like the measured ones fit on a box, a fifth kept back for the OS and spikes, and euros a game a
 *  month; against a Durable Object room that can't hibernate, which bills 128 MB all month whatever it holds. */
export function gamesPerBox(box: Box = HETZNER[0]!.boxes[0]!) {
  const g = ONE_BOX.games, avgMb = g.reduce((a, x) => a + x.busyMb, 0) / g.length;
  const roomMb = g.reduce((a, x) => a + (x.busyMb - x.idleMb), 0) / g.length / ONE_BOX.rooms;
  const fit = Math.floor((box.gb * 1024 * 0.8) / avgMb);
  return { box, avgMb, roomMb, fit, eurPerGame: box.eur / fit, doRoomUsd: MONTH * 0.125 * 12.5 / 1e6 };
}
