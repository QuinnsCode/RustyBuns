// Battles: many players in one repo. The game with a mode, the room that runs it for a world,
// the world behind sockets, and the page's mirror of it.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS } from "../src/levels/levels.ts";
import { groundAt } from "../src/levels/place.ts";
import type { Block } from "../src/sim/codemap.ts";
import { FFA_SCORE, Game, MAX_REWIND, RESPAWN, type GameEvent, type Input, type Mode } from "../src/sim/game.ts";
import { Mirror } from "../src/net/mirror.ts";
import { battleGame, cleanSetup, Room } from "../src/net/room.ts";
import { cleanInput, decodeSnap, encodeSnap, MAX_PLAYERS, packSoldier, unpackSoldier, VIEW, type FromWorld, type Setup, type Snap } from "../src/net/wire.ts";
import World, { CLOSE_FULL, CLOSE_IDLE, CLOSE_REPLACED, IDLE_MS } from "../src/net/world.ts";

setDefaultTimeout(30_000);

const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
const flat = { R: 80, height: () => 0 };

/** A flat field with compounds where you say, as a battle. */
function field(mode: Mode, compounds: { x: number; z: number; guards: number }[] = [], blocks: Block[] = []) {
  return new Game({
    terrain: flat,
    spawn: { x: 0, z: 0, yaw: 0 },
    compounds: compounds.map((c, i) => ({ folder: `apps/c${i}`, x: c.x, z: c.z, r: 8, files: 1, lines: 1, guards: c.guards })),
    blocks,
  }, 4, { kind: "clear" }, mode);
}
const run = (g: Game, seconds: number, inputs: Map<number, Input>) => { for (let i = 0; i < seconds * 60; i++) g.step(1 / 60, inputs); };

describe("a battle", () => {
  test("players join after the guards, and a left player's slot goes to the next", () => {
    const g = field("coop", [{ x: 0, z: -40, guards: 2 }]);
    const a = g.join("ada"), b = g.join("bob");
    expect([a.id, b.id]).toEqual([2, 3]);
    expect(a.team).toBe("you");
    g.leave(a.id);
    expect(g.players().map((p) => p.name)).toEqual(["bob"]);
    expect(g.join("cy").id).toBe(2);
  });

  test("teams fill the side with fewer players", () => {
    const g = field("teams");
    expect(["a", "b", "c", "d"].map((n) => g.join(n).team)).toEqual(["ours", "theirs", "ours", "theirs"]);
  });

  test("side by side, players' rounds pass through each other; in a free-for-all they don't", () => {
    for (const [mode, hurt] of [["coop", false], ["ffa", true]] as const) {
      const g = field(mode), a = g.join("a"), b = g.join("b");
      Object.assign(a, { x: 0, z: 0 }), Object.assign(b, { x: 0, z: -8 });
      g.step(0.3, new Map([[a.id, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -8 } }]]));
      expect(b.hp < b.maxHp || b.shield < b.maxShield).toBe(hurt);
    }
  });

  test("on every level, the two sides come in far apart and clear of the compounds", () => {
    for (const l of LEVELS) {
      const g = new Room(setup("teams", l.id)).game, ours = g.join("a"), theirs = g.join("b");
      // Far apart, and somewhere theirs can walk from (Glacier Point's rim is a narrow shelf).
      expect(Math.hypot(ours.x - theirs.x, ours.z - theirs.z)).toBeGreaterThan(60);
      for (const c of g.map.compounds) expect(Math.hypot(c.x - theirs.x, c.z - theirs.z) - c.r).toBeGreaterThan(15);
    }
  });

  test("on teams, only the other side's rounds hurt", () => {
    const g = field("teams"), a = g.join("a"), b = g.join("b"), c = g.join("c");
    expect([a.team, b.team, c.team]).toEqual(["ours", "theirs", "ours"]);
    Object.assign(a, { x: 0, z: 0 }), Object.assign(c, { x: 0, z: -8 }), Object.assign(b, { x: 6, z: -8 });
    g.step(0.3, new Map([[a.id, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -8 } }]]));
    expect(c.shield).toBe(c.maxShield);
    g.step(0.3, new Map([[a.id, { ...idle, fire: true, aim: { x: 6, y: 1.2, z: -8 } }]]));
    expect(b.shield).toBeLessThan(b.maxShield);
  });

  test("a downed player scores for whoever downed them and comes back RESPAWN seconds later", () => {
    const g = field("ffa"), a = g.join("a"), b = g.join("b");
    g.hurt(b, 1000, a.id);
    expect(b.alive).toBe(false);
    expect([a.score, b.deaths]).toEqual([1, 1]);
    run(g, RESPAWN - 0.5, new Map());
    expect(b.alive).toBe(false);
    run(g, 1, new Map());
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(b.maxHp);
    expect(g.lives).toBe(3); // battles don't spend the reflog
  });

  test("a free-for-all goes to the first to FFA_SCORE", () => {
    const g = field("ffa"), a = g.join("ada"), b = g.join("bob");
    for (let i = 0; i < FFA_SCORE; i++) {
      g.hurt(b, 1000, a.id);
      run(g, RESPAWN + 0.1, new Map());
    }
    expect(g.status).toBe("won");
    expect(g.winner).toBe("ada");
  });

  test("guards go for the nearest player they can see", () => {
    const g = field("coop", [{ x: 0, z: -30, guards: 1 }]), a = g.join("far"), b = g.join("near");
    Object.assign(a, { x: 60, z: 10 }), Object.assign(b, { x: 0, z: -12 });
    run(g, 3, new Map());
    expect(b.hp + b.shield).toBeLessThan(b.maxHp + b.maxShield);
    expect(a.hp + a.shield).toBe(a.maxHp + a.maxShield);
  });

  test("a lagging player's rounds hit where the target was when they saw it", () => {
    for (const lag of [0, 0.25]) {
      const g = field("ffa"), a = g.join("a"), b = g.join("b");
      Object.assign(a, { x: 0, z: 0 }), Object.assign(b, { x: 0, z: -8 });
      run(g, 0.5, new Map());
      Object.assign(b, { x: 3 }); // stepped out of the line of fire, after the shooter saw it
      g.lags.set(a.id, lag);
      g.step(0.1, new Map([[a.id, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -8 } }]]));
      expect(b.hp < b.maxHp || b.shield < b.maxShield).toBe(lag > 0);
    }
  });

  test("no further back than MAX_REWIND, and guards' rounds never rewind", () => {
    const g = field("ffa", [{ x: 0, z: -30, guards: 1 }]), a = g.join("a"), guard = g.soldiers.find((s) => s.brain)!;
    g.lags.set(a.id, 5), g.lags.set(guard.id, 5);
    g.fire(a, { x: 0, y: 1, z: -10 }), g.fire(guard, { x: 0, y: 1, z: 0 });
    expect(g.shots.find((p) => p.owner === a.id)!.rewind).toBe(MAX_REWIND);
    expect(g.shots.find((p) => p.owner === guard.id)!.rewind).toBeUndefined();
  });

  test("each player's input moves only their soldier", () => {
    const g = field("coop"), a = g.join("a"), b = g.join("b"), bz = b.z;
    run(g, 1, new Map([[a.id, { ...idle, forward: 1 }]]));
    expect(a.z).toBeLessThan(-3);
    expect(b.z).toBeCloseTo(bz, 1);
  });
});

describe("the wire", () => {
  test("a soldier packs and unpacks", () => {
    const g = field("ffa"), a = g.join("a"), b = g.join("b");
    Object.assign(a, { x: 1.234, y: 2, z: -3.456, yaw: 1.2345, crouch: true, burn: 2, weapon: "push" });
    unpackSoldier(packSoldier(a), b);
    expect([b.x, b.z, b.yaw, b.crouch, b.burn > 0, b.weapon]).toEqual([1.23, -3.46, 1.235, true, true, "push"]);
  });

  test("a snapshot goes through the binary frame and back the same", () => {
    const snap: Snap = {
      t: "snap", seq: 70_000, base: 69_998, input: 1_234, time: 12.345, status: "won", winner: "ada",
      soldiers: [[3, 1.25, null, -80.5, null, null, null, 6.283, null, 100, null, 5, 2, null, -0.5], [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      gone: [4, 7], shots: [[123_456, 3, "theirs", "push", 1.5, 2, -3.25, 110, 0, -5.5, 0.42]], spent: [200_000], stashes: [[99, 1, 2, 3]],
      cleared: [true, false], files: [["src/a.ts", 0, 0]], events: [{ kind: "cleared", compound: 1 }],
      you: { ammo: [-1, 30, 0], loaded: [-1, 12, 0], reload: 1.25, cd: 0.08, heat: 0.3, shieldT: 4, rollCd: 0 },
    };
    const bytes = encodeSnap(snap);
    expect(decodeSnap(bytes)).toEqual(snap);
    expect(decodeSnap(encodeSnap({ ...snap, you: null }))!.you).toBeNull();
    // Nothing optional, nothing in the tail: just the header and the counts.
    expect(encodeSnap({ ...snap, winner: undefined, cleared: undefined, you: undefined, files: [], events: [], soldiers: [], gone: [], shots: [], spent: [], stashes: [] }).length).toBe(35);
    expect(decodeSnap(new Uint8Array([9, 9, 9]))).toBeNull();
  });

  test("every kind of event goes through the frame and back, to the centimetre", () => {
    const events: GameEvent[] = [
      { kind: "fire", id: 3, weapon: "push" }, { kind: "hit", target: 3, by: -1, damage: 12.5, shield: true, head: false },
      { kind: "shield", id: 3, state: "charging" }, { kind: "boom", x: 1.25, y: -2, z: 300.5, r: 4.5 }, { kind: "down", id: 3, by: 9 },
      { kind: "respawn", id: 3, lives: -1 }, { kind: "chute", id: 3, open: true }, { kind: "cleared", compound: 2 }, { kind: "pickup", id: 3, item: "reset" },
      { kind: "blamed", id: 4 }, { kind: "reverted", id: 4 }, { kind: "stashed", x: 1, y: 2, z: 3 }, { kind: "impact", x: 0.01, y: 0, z: -9.99, weapon: "fetch" },
      { kind: "razed", path: "src/ünïcode.ts", lines: 120, by: 3, x: 1, y: 0, z: 2, w: 4.5, h: 12, d: 6 },
      { kind: "objective", text: "main held" }, { kind: "reload", id: 3, weapon: "add" }, { kind: "streak", vehicle: "heli", kills: 5 },
      { kind: "board", vehicle: "roadster", on: false }, { kind: "vehicleHit", id: 100_000, damage: 40 }, { kind: "wrecked", id: 100_000, vehicle: "heli" },
      { kind: "won" }, { kind: "lost" }, { kind: "joined", id: 7 }, { kind: "left", id: 7 },
    ];
    const snap: Snap = { t: "snap", seq: 1, base: 0, input: 0, time: 0, status: "playing", soldiers: [], gone: [], shots: [], spent: [], stashes: [], files: [], events };
    expect(decodeSnap(encodeSnap(snap))!.events).toEqual(events);
    // A fire event is 4 bytes, where its JSON was about 35.
    expect(encodeSnap({ ...snap, events: [events[0]!] }).length - encodeSnap({ ...snap, events: [] }).length).toBe(4);
  });

  test("inputs are cleaned: numbers in range, real weapons, a finite aim", () => {
    expect(cleanInput({ right: 9, forward: "x", yaw: 1, pitch: 9, fire: 1, weapon: "rm -rf", aim: { x: 1, y: NaN, z: 0 } }))
      .toEqual({ right: 1, forward: 0, yaw: 1, pitch: 1.6, jump: false, roll: false, crouch: false, prone: false, scope: false, fire: false, reload: false, lean: 0, aim: undefined, weapon: undefined });
    expect(cleanInput({ seq: 7, view: 12.5 })).toMatchObject({ seq: 7, view: 12.5 });
    const bad = cleanInput({ seq: -1.5, view: Infinity })!;
    expect("seq" in bad || "view" in bad).toBe(false);
    expect(cleanInput(null)).toBeNull();
  });

  test("a setup needs a level the world has, a mode, and a repo", () => {
    const repo = LEVELS[0]!.repo;
    expect(cleanSetup({ level: "el-capitan", mode: "ffa", repo })).not.toBeNull();
    expect(cleanSetup({ level: "the-moon", mode: "ffa", repo })).toBeNull();
    expect(cleanSetup({ level: "el-capitan", mode: "battle-royale", repo })).toBeNull();
    expect(cleanSetup({ level: "el-capitan", mode: "ffa", repo: { name: "x", ref: "y", files: [{ path: 1 }] } })).toBeNull();
  });

  test("a lat/long setup brings its ground, and the world and the page build the same battle on it", async () => {
    const tile = new Uint8Array(await Bun.file(new URL("./fixtures/terrarium-14-2752-6334.png", import.meta.url)).arrayBuffer());
    const zone = await groundAt(37.744657, -119.520264, { realRadius: 700, tiles: async () => tile });
    const repo = LEVELS[0]!.repo, level = `place:${zone.id}`;
    const clean = cleanSetup(JSON.parse(JSON.stringify({ level, mode: "ffa", repo, zone: { ...zone, name: "<b>pwned</b>" } })))!;
    expect(clean.zone!.name).toBe(zone.name);
    expect(clean.zone!.heights).toBe(zone.heights);
    const world = new Room(clean).game, page = battleGame(JSON.parse(JSON.stringify(clean)));
    expect(page.map.compounds.map((c) => [c.folder, c.x, c.z])).toEqual(world.map.compounds.map((c) => [c.folder, c.x, c.z]));
    expect(world.map.compounds.length).toBeGreaterThan(0);

    // No ground, the wrong place, or heights that aren't n*n: turned away.
    expect(cleanSetup({ level, mode: "ffa", repo })).toBeNull();
    expect(cleanSetup({ level: "place:0.0000,0.0000", mode: "ffa", repo, zone })).toBeNull();
    expect(cleanSetup({ level, mode: "ffa", repo, zone: { ...zone, heights: zone.heights.slice(4) } })).toBeNull();
    expect(cleanSetup({ level, mode: "ffa", repo, zone: { ...zone, n: 100_000 } })).toBeNull();
    expect(cleanSetup({ level, mode: "ffa", repo, zone: { ...zone, realRadius: Infinity } })).toBeNull();
  });
});

const setup = (mode: Mode = "ffa", level = "backyard"): Setup => ({ level, mode, repo: LEVELS.find((l) => l.id === level)!.repo });

describe("the room", () => {
  test("holds MAX_PLAYERS, and a rejoin under the same key keeps the soldier", () => {
    const room = new Room(setup());
    const first = room.join("k0", "p0", { head: "ball", build: "average" });
    expect(room.join("k0", "again", { head: "ball", build: "average" })).toBe(first);
    for (let i = 1; i < MAX_PLAYERS; i++) expect(room.join(`k${i}`, `p${i}`, { head: "ball", build: "average" })).not.toBeNull();
    expect(room.join("one-too-many", "x", { head: "ball", build: "average" })).toBeNull();
  });

  test("a snapshot holds only what's within VIEW of you, and your own ammo", () => {
    const room = new Room(setup()), look = { head: "ball", build: "average" };
    const a = room.join("a", "a", look)!, b = room.join("b", "b", look)!;
    const g = room.game;
    Object.assign(g.soldiers[a]!, { x: 0, z: 0 }), Object.assign(g.soldiers[b]!, { x: VIEW + 20, z: 0 });
    const snap = room.snap("a", room.drain())!;
    const ids = snap.soldiers.map((s) => s[0]);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    expect(snap.you!.ammo.length).toBeGreaterThan(5);
    expect(snap.roster!.map((r) => r.name)).toEqual(["a", "b"]);
    // The roster only comes again when it changes.
    expect(room.drain().roster).toBeUndefined();
  });

  test("a tap between steps still acts: a click that's up again before the step fires", () => {
    const room = new Room(setup("ffa")), look = { head: "ball", build: "average" };
    const a = room.join("a", "a", look)!;
    room.tick(0);
    room.input("a", { ...idle, fire: true });
    room.input("a", { ...idle, fire: false });
    room.tick(50);
    expect(room.drain().events.some((e) => e.kind === "fire" && e.id === a)).toBe(true);
  });

  test("files that lose lines go out once, and a newcomer gets them all", () => {
    const room = new Room(setup()), g = room.game, look = { head: "ball", build: "average" };
    room.join("a", "a", look);
    const b = g.map.blocks[0]!;
    (g as any).wreck(b, 1e9, 0);
    const first = room.drain().files;
    expect(first).toContainEqual([b.path, 0, 0]);
    expect(room.drain().files).toEqual([]);
    expect(room.filesNow()).toContainEqual([b.path, 0, 0]);
  });

  test("an acked snapshot is the base: what didn't change stays out, and what left view goes by id", () => {
    const room = new Room(setup()), look = { head: "ball", build: "average" }, g = room.game;
    const a = room.join("a", "a", look)!, b = room.join("b", "b", look)!;
    Object.assign(g.soldiers[a]!, { x: 0, z: 0 }), Object.assign(g.soldiers[b]!, { x: 10, z: 0 });
    const first = room.snap("a", room.drain())!;
    expect(first.base).toBe(0);
    // Not acked yet: the next one is whole too.
    expect(room.snap("a", room.drain())!.base).toBe(0);
    room.ack("a", first.seq);
    Object.assign(g.soldiers[b]!, { x: 11 });
    const next = room.snap("a", room.drain())!;
    expect(next.base).toBe(first.seq);
    expect(next.soldiers.map((s) => s[0])).toEqual([b]);
    const d = next.soldiers[0]!;
    expect([d[1], d[2], d[3], d[9]]).toEqual([11, null, null, null]); // x, and not y, z or hp
    expect(next.you).toBeUndefined(); // your ammo's as it was
    room.ack("a", next.seq);
    Object.assign(g.soldiers[b]!, { x: VIEW + 20 });
    expect(room.snap("a", room.drain())!.gone).toEqual([b]);
    // An ack for a snapshot that was never sent, or an older one, changes nothing.
    room.ack("a", 9999), room.ack("a", first.seq);
    expect(room.snap("a", room.drain())!.base).toBe(next.seq);
  });

  test("MAX_PLAYERS: a second of battle steps fast enough, and a snapshot stays small", () => {
    const n = MAX_PLAYERS;
    const room = new Room(setup("teams", "el-capitan")), look = { head: "ball", build: "average" };
    for (let i = 0; i < n; i++) room.join(`k${i}`, `player ${i}`, look);
    let t = 0, sent = 0;
    room.tick(t);
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      // Half stand still (the guards come and go as they will).
      for (let p = 0; p < n; p++) room.input(`k${p}`, { ...idle, forward: p % 2, yaw: p, fire: p % 3 === 0, aim: { x: 0, y: 1, z: 0 } });
      room.tick((t += 50));
      const shared = room.drain();
      for (let p = 0; p < n; p++) {
        const snap = room.snap(`k${p}`, shared)!, bytes = encodeSnap(snap);
        if (i >= 10) sent += bytes.length;
        room.ack(`k${p}`, decodeSnap(bytes)!.seq);
      }
    }
    const ms = performance.now() - start;
    const json = JSON.stringify(room.snap("k0", room.drain(), true)).length, whole = encodeSnap(room.snap("k0", room.drain(), true)!).length;
    const delta = Math.round(sent / 10 / n);
    console.log(`${n} players: a second of battle in ${ms.toFixed(0)} ms; one snapshot ${whole} bytes whole (${json} as JSON), ${delta} as an acked delta; ${(delta * 20 / 1024).toFixed(1)} KB/s a player`);
    expect(ms).toBeLessThan(1000);
    expect(whole).toBeLessThan(json * 0.75);
    expect(delta).toBeLessThan(whole);
  });
});

// Just enough of a Durable Object and its sockets.
class Sock {
  readyState = 1;
  sent: FromWorld[] = [];
  closed: number | null = null;
  private att: unknown;
  send(s: string | Uint8Array) { this.sent.push(typeof s === "string" ? JSON.parse(s) : decodeSnap(s)!); }
  close(code: number) { this.closed = code, (this.readyState = 3); }
  serializeAttachment(a: unknown) { this.att = a; }
  deserializeAttachment() { return this.att; }
  last<K extends FromWorld["t"]>(t: K) { return this.sent.findLast((m) => m.t === t) as Extract<FromWorld, { t: K }> | undefined; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }

describe("the world", () => {
  let real: unknown;
  const worlds: World[] = [];
  beforeAll(() => { real = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; });
  afterAll(() => { (globalThis as any).WebSocketPair = real; });
  afterEach(() => { for (const w of worlds.splice(0)) clearInterval((w as any).timer); });

  function world() {
    const socks: Sock[] = [];
    const w = new World({ acceptWebSocket(s: Sock) { socks.push(s); }, getWebSockets: () => socks.filter((s) => s.readyState === 1) }, {});
    worlds.push(w);
    const join = async (uid: string, name: string, guest = true) => {
      const res = await w.fetch(new Request("https://world/ws?head=bun&build=lank", { headers: { Upgrade: "websocket", "X-User-Id": uid, "X-User-Name": name, ...(guest ? { "X-RB-Principal": "guest" } : {}) } }));
      expect(res.status).toBe(101);
      return socks.at(-1)!;
    };
    const tick = () => (w as any).tick();
    return { w, join, tick };
  }

  test("guests wait for the host's setup, then everyone's welcomed into the same battle", async () => {
    const { w, join } = world();
    const guest = await join("guest-secret-1", "Guest");
    expect(guest.sent[0]).toEqual({ t: "wait" });
    const host = await join("host-secret-1", "Host", false);
    w.webSocketMessage(guest, JSON.stringify({ t: "setup", setup: setup("teams") }));
    expect(w.room).toBeNull(); // a guest can't pick
    w.webSocketMessage(host, JSON.stringify({ t: "setup", setup: setup("teams") }));
    const a = guest.last("welcome")!, b = host.last("welcome")!;
    expect(a.setup.mode).toBe("teams");
    expect(a.me).not.toBe(b.me);
    expect(b.roster.map((r) => r.name).sort()).toEqual(["Guest", "Host"]);
    expect(b.roster.find((r) => r.name === "Guest")!.look).toEqual({ head: "bun", build: "lank" });
    // Nobody's uid goes out.
    for (const uid of ["guest-secret-1", "host-secret-1"]) expect(JSON.stringify([guest.sent, host.sent])).not.toContain(uid);
  });

  test("inputs move the player, and snapshots carry it", async () => {
    const { w, join, tick } = world();
    const host = await join("host-1", "Host", false);
    w.webSocketMessage(host, JSON.stringify({ t: "setup", setup: setup("coop") }));
    const me = host.last("welcome")!.me, z0 = w.room!.game.soldiers[me]!.z;
    tick();
    w.webSocketMessage(host, JSON.stringify({ t: "in", i: { ...idle, forward: 1, yaw: 0 } }));
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(50);
      tick();
    }
    const snap = host.last("snap")!, mine = snap.soldiers.find((s) => s[0] === me)!;
    expect(mine[3]!).toBeLessThan(z0 - 1);
  });

  test("the same player again replaces their older socket; a full room turns the next away", async () => {
    const { w, join } = world();
    const host = await join("host-1", "Host", false);
    w.webSocketMessage(host, JSON.stringify({ t: "setup", setup: setup() }));
    const again = await join("host-1", "Host", false);
    expect(host.closed).toBe(CLOSE_REPLACED);
    expect(again.last("welcome")).toBeDefined();
    for (let i = 1; i < MAX_PLAYERS; i++) await join(`p${i}`, `p${i}`);
    const late = await join("late", "late");
    expect(late.closed).toBe(CLOSE_FULL);
  });

  test("a guest leaving takes their soldier out", async () => {
    const { w, join } = world();
    const host = await join("host-1", "Host", false);
    w.webSocketMessage(host, JSON.stringify({ t: "setup", setup: setup() }));
    const guest = await join("g-1", "Guest");
    expect(w.room!.count).toBe(2);
    guest.close(1000);
    w.webSocketClose(guest);
    expect(w.room!.count).toBe(1);
  });
});

describe("the world online", () => {
  let real: unknown;
  beforeAll(() => { real = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; });
  afterAll(() => { (globalThis as any).WebSocketPair = real; });

  function world() {
    const socks: Sock[] = [];
    const w = new World({ acceptWebSocket(s: Sock) { socks.push(s); }, getWebSockets: () => socks.filter((s) => s.readyState === 1) }, { ONLINE: "1" });
    const join = async (uid: string) => {
      await w.fetch(new Request("https://world/ws", { headers: { Upgrade: "websocket", "X-User-Id": uid, "X-User-Name": uid, "X-RB-Principal": "guest" } }));
      return socks.at(-1)!;
    };
    const stop = () => clearInterval((w as any).timer);
    return { w, join, stop };
  }

  test("everyone's a guest: the first to pick owns the room, and only they pick again", async () => {
    const { w, join, stop } = world();
    const a = await join("player-a"), b = await join("player-b");
    w.webSocketMessage(a, JSON.stringify({ t: "setup", setup: setup("coop") }));
    expect(w.room!.setup.mode).toBe("coop");
    w.webSocketMessage(b, JSON.stringify({ t: "setup", setup: setup("ffa") }));
    expect(w.room!.setup.mode).toBe("coop");
    w.webSocketMessage(a, JSON.stringify({ t: "setup", setup: setup("ffa") }));
    expect(w.room!.setup.mode).toBe("ffa");
    expect(b.last("welcome")!.setup.mode).toBe("ffa");
    stop();
  });

  test("the battle ends once everyone's left, and the code is free for a new pick", async () => {
    const { w, join } = world();
    const a = await join("player-a");
    w.webSocketMessage(a, JSON.stringify({ t: "setup", setup: setup("coop") }));
    a.close(1000), w.webSocketClose(a);
    expect(w.room).toBeNull();
    expect((w as any).timer).toBeNull();
    const b = await join("player-b");
    expect(b.sent[0]).toEqual({ t: "wait" });
    w.webSocketMessage(b, JSON.stringify({ t: "setup", setup: setup("teams") }));
    expect(b.last("welcome")!.setup.mode).toBe("teams");
    clearInterval((w as any).timer);
  });

  test("a room nobody plays in closes after IDLE_MS, so it stops costing", async () => {
    const { w, join } = world();
    const a = await join("player-a");
    w.webSocketMessage(a, JSON.stringify({ t: "setup", setup: setup("coop") }));
    w.webSocketMessage(a, JSON.stringify({ t: "in", i: idle }));
    (w as any).tick();
    expect(a.closed).toBeNull();
    (w as any).lastInput = Date.now() - IDLE_MS - 1;
    (w as any).tick();
    expect(a.closed).toBe(CLOSE_IDLE);
    expect(w.room).toBeNull();
    expect((w as any).timer).toBeNull();
  });

  test("on the desktop the idle rule is off", async () => {
    const { w, join } = (() => {
      const socks: Sock[] = [];
      const w = new World({ acceptWebSocket(s: Sock) { socks.push(s); }, getWebSockets: () => socks.filter((s) => s.readyState === 1) }, {});
      return { w, join: async (uid: string) => (await w.fetch(new Request("https://world/ws", { headers: { Upgrade: "websocket", "X-User-Id": uid } })), socks.at(-1)!) };
    })();
    const host = await join("host-1");
    w.webSocketMessage(host, JSON.stringify({ t: "setup", setup: setup("coop") }));
    (w as any).lastInput = Date.now() - IDLE_MS - 1;
    (w as any).tick();
    expect(host.closed).toBeNull();
    clearInterval((w as any).timer);
  });
});

describe("the page's mirror", () => {
  function battle() {
    const room = new Room(setup("ffa")), look = { head: "ball", build: "average" };
    const a = room.join("a", "a", look)!, b = room.join("b", "b", look)!;
    const snap = room.snap("a", { events: [], files: [] }, true)!;
    const m = new Mirror({ t: "welcome", setup: room.setup, me: a, roster: room.rosterNow(), files: room.filesNow(), snap });
    room.ack("a", m.acked);
    return { room, m, a, b };
  }
  const send = (room: Room, key: string): Snap => decodeSnap(encodeSnap(room.snap(key, room.drain())!))!;

  test("builds the same map and puts everyone where the world has them", () => {
    const { room, m, b } = battle();
    expect(m.game.map.blocks.length).toBe(room.game.map.blocks.length);
    expect(m.game.soldiers[b]!.x).toBeCloseTo(room.game.soldiers[b]!.x, 1);
    expect(m.me.name).toBe("a");
  });

  test("everyone else is drawn between the two snapshots around INTERP ago", () => {
    const { room, m, b } = battle();
    const other = room.game.soldiers[b]!;
    let t = 0;
    room.tick(t);
    for (let i = 0; i < 6; i++) {
      room.input("b", { ...idle, forward: 1, yaw: Math.PI / 2 }); // west
      room.tick((t += 50));
      m.apply(send(room, "a"));
    }
    m.frame(0, idle);
    const drawn = m.game.soldiers[b]!.x;
    expect(drawn).toBeGreaterThan(other.x); // a little behind (east of) where it is
    expect(drawn - other.x).toBeLessThan(1.5);
  });

  test("your soldier moves on your keys before the world says so, and jumps back if it's far off", () => {
    const { room, m } = battle();
    const z0 = m.me.z;
    for (let i = 0; i < 30; i++) m.frame(1 / 60, { ...idle, forward: 1 });
    expect(m.me.z).toBeLessThan(z0 - 2);
    // The world had every input and never moved you: a far-off you is put back.
    let last = idle;
    for (let i = 0; i < 60; i++) last = m.frame(1 / 60, { ...idle, forward: 1 });
    room.input("a", { ...idle, seq: last.seq });
    m.apply(send(room, "a"));
    expect(m.me.z).toBeCloseTo(room.game.soldiers[m.game.me]!.z, 0);
  });

  test("over acked binary deltas, the page has what the world has: soldiers, rounds, and who's out of view", () => {
    const { room, m, a, b } = battle(), g = room.game;
    let t = 0, full = 0, sent = 0;
    room.tick(t);
    for (let i = 0; i < 40; i++) {
      room.input("a", { ...idle, fire: i < 10, aim: { x: 0, y: 1, z: -50 } });
      room.input("b", { ...idle, forward: 1, yaw: i * 0.2 });
      room.tick((t += 50));
      const snap = room.snap("a", room.drain())!, bytes = encodeSnap(snap);
      if (!snap.base) full++;
      sent += bytes.length;
      expect(m.apply(decodeSnap(bytes)!)).toBe(true);
      room.ack("a", m.acked);
    }
    expect(full).toBe(0); // the welcome was the base the rest built on
    const theirs = g.soldiers[b]!, mine = m.game.soldiers[b]!;
    m.frame(0, idle);
    expect(Math.hypot(theirs.x - mine.x, theirs.z - mine.z)).toBeLessThan(1);
    expect(m.game.shots.map((p) => p.id).sort()).toEqual(g.shots.map((p) => p.id).sort());
    for (const p of g.shots) {
      const q = m.game.shots.find((x) => x.id === p.id)!;
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(0.2);
    }
    expect(m.me.hp).toBe(Math.ceil(g.soldiers[a]!.hp));
    // b walks out of view: on the page it's hidden, not left where it was seen.
    Object.assign(theirs, { x: g.soldiers[a]!.x + VIEW + 30 });
    room.tick((t += 50));
    m.apply(decodeSnap(encodeSnap(room.snap("a", room.drain())!))!);
    expect(mine.hidden).toBe(true);
  });

  test("files the world razed go on the page too, and events come through once", () => {
    const { room, m } = battle();
    const b = room.game.map.blocks[0]!;
    (room.game as any).wreck(b, 1e9, 0);
    const snap = send(room, "a");
    snap.events.push({ kind: "cleared", compound: 0 });
    m.apply(snap);
    expect(m.game.map.blocks.some((x) => x.path === b.path)).toBe(false);
    expect(m.take()).toEqual([{ kind: "cleared", compound: 0 }]);
    expect(m.take()).toEqual([]);
  });

  test("inputs go out numbered and stamped; the world echoes the number and reckons the lag from the stamp", () => {
    const { room, m, a } = battle();
    const one = m.frame(1 / 60, idle), two = m.frame(1 / 60, idle);
    expect([one.seq, two.seq]).toEqual([1, 2]);
    expect(two.view).toBeCloseTo(room.game.time + 2 / 60 - 0.1, 3); // INTERP behind the page's clock
    room.game.time += 0.15;
    room.input("a", two);
    expect(send(room, "a").input).toBe(2);
    expect(room.game.lags.get(a)).toBeCloseTo(0.15 - 2 / 60 + 0.1, 3);
    room.input("a", { ...idle, view: -100 });
    expect(room.game.lags.get(a)).toBe(MAX_REWIND);
  });

  test("a correction plays your frames since on top, so it doesn't fight a fast strafe", () => {
    const { room, m } = battle();
    // The same page with no world: where your keys alone put you.
    const alone = battle().m;
    const ONE_WAY = 6; // frames each way: a 200 ms round trip
    const up: Input[][] = [], down: Snap[][] = [];
    let t = 0;
    room.tick(t);
    let worst = 0;
    for (let f = 0; f < 180; f++) {
      const keys = { ...idle, right: f < 120 ? 1 : -1 };
      up[f + ONE_WAY] = [m.frame(1 / 60, keys)];
      alone.frame(1 / 60, keys);
      for (const i of up[f] ?? []) room.input("a", i);
      room.tick((t += 1000 / 60));
      if (f % 3 === 0) (down[f + ONE_WAY] ??= []).push(send(room, "a"));
      for (const snap of down[f] ?? []) m.apply(snap);
      worst = Math.max(worst, Math.hypot(m.me.x - alone.me.x, m.me.z - alone.me.z));
    }
    expect(worst).toBeLessThan(0.3);
  });
});
