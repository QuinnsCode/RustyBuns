// Battles: many players in one repo. The game with a mode, the room that runs it for a world,
// the world behind sockets, and the page's mirror of it.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS } from "../src/levels/levels.ts";
import type { Block } from "../src/sim/codemap.ts";
import { FFA_SCORE, Game, RESPAWN, type Input, type Mode } from "../src/sim/game.ts";
import { Mirror } from "../src/net/mirror.ts";
import { cleanSetup, Room } from "../src/net/room.ts";
import { cleanInput, MAX_PLAYERS, packSoldier, unpackSoldier, VIEW, type FromWorld, type Setup, type Snap } from "../src/net/wire.ts";
import World, { CLOSE_FULL, CLOSE_REPLACED } from "../src/net/world.ts";

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
      expect(Math.hypot(ours.x - theirs.x, ours.z - theirs.z)).toBeGreaterThan(100);
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

  test("inputs are cleaned: numbers in range, real weapons, a finite aim", () => {
    expect(cleanInput({ right: 9, forward: "x", yaw: 1, pitch: 9, fire: 1, weapon: "rm -rf", aim: { x: 1, y: NaN, z: 0 } }))
      .toEqual({ right: 1, forward: 0, yaw: 1, pitch: 1.6, jump: false, roll: false, crouch: false, prone: false, scope: false, fire: false, aim: undefined, weapon: undefined });
    expect(cleanInput(null)).toBeNull();
  });

  test("a setup needs a level the world has, a mode, and a repo", () => {
    const repo = LEVELS[0]!.repo;
    expect(cleanSetup({ level: "el-capitan", mode: "ffa", repo })).not.toBeNull();
    expect(cleanSetup({ level: "the-moon", mode: "ffa", repo })).toBeNull();
    expect(cleanSetup({ level: "el-capitan", mode: "battle-royale", repo })).toBeNull();
    expect(cleanSetup({ level: "el-capitan", mode: "ffa", repo: { name: "x", ref: "y", files: [{ path: 1 }] } })).toBeNull();
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

  test("32 players: a second of battle steps fast enough, and a snapshot stays small", () => {
    const room = new Room(setup("teams", "el-capitan")), look = { head: "ball", build: "average" };
    for (let i = 0; i < 32; i++) room.join(`k${i}`, `player ${i}`, look);
    let t = 0;
    room.tick(t);
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      for (let p = 0; p < 32; p++) room.input(`k${p}`, { ...idle, forward: 1, yaw: p, fire: p % 3 === 0, aim: { x: 0, y: 1, z: 0 } });
      room.tick((t += 50));
      const shared = room.drain();
      for (let p = 0; p < 32; p++) room.snap(`k${p}`, shared);
    }
    const ms = performance.now() - start;
    const bytes = JSON.stringify(room.snap("k0", room.drain())).length;
    console.log(`32 players: a second of battle in ${ms.toFixed(0)} ms; one snapshot ${bytes} bytes`);
    expect(ms).toBeLessThan(1000);
    expect(bytes).toBeLessThan(20_000);
  });
});

// Just enough of a Durable Object and its sockets.
class Sock {
  readyState = 1;
  sent: FromWorld[] = [];
  closed: number | null = null;
  private att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
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
    const w = new World({ acceptWebSocket: (s: Sock) => socks.push(s), getWebSockets: () => socks.filter((s) => s.readyState === 1) }, {});
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
    expect(JSON.stringify([guest.sent, host.sent])).not.toContain("secret");
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

describe("the page's mirror", () => {
  function battle() {
    const room = new Room(setup("ffa")), look = { head: "ball", build: "average" };
    const a = room.join("a", "a", look)!, b = room.join("b", "b", look)!;
    const snap = room.snap("a", { events: [], files: [] })!;
    const m = new Mirror({ t: "welcome", setup: room.setup, me: a, roster: room.rosterNow(), files: room.filesNow(), snap });
    return { room, m, a, b };
  }
  const send = (room: Room, key: string): Snap => room.snap(key, room.drain())!;

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
    // The world never moved you: a far-off you is put back.
    for (let i = 0; i < 60; i++) m.frame(1 / 60, { ...idle, forward: 1 });
    m.apply(send(room, "a"));
    expect(m.me.z).toBeCloseTo(room.game.soldiers[m.game.me]!.z, 0);
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
});
