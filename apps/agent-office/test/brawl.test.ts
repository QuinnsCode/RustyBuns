import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Curtain, Feed, FloorBrawl, phaseAt, PREFIX, stackIndex, type Board, type WbEl } from "../live/brawl.ts";
import type { LogEntry, MatchState } from "../../excalibrawl/src/engine/match.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A board that merges like the office's (newer version wins) and counts what it told the floor. */
function board(els: WbEl[] = [], watching = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "brawl-"));
  dirs.push(dir);
  const map = new Map(els.map((e) => [e.id, e]));
  const sent: WbEl[][] = [];
  const b: Board & { map: Map<string, WbEl>; sent: WbEl[][]; live: () => WbEl[] } = {
    map, sent, dir,
    scene: () => [...map.values()],
    put: (incoming) => {
      const ok = incoming.filter((e) => { const had = map.get(e.id); return !had || e.version > had.version; });
      ok.forEach((e) => map.set(e.id, e));
      sent.push(ok);
    },
    watching: () => watching,
    live: () => [...map.values()].filter((e) => !e.isDeleted),
  };
  return b;
}

const drawing = (): WbEl[] => [
  { id: "cat", type: "ellipse", x: 100, y: 100, width: 200, height: 100, version: 3, versionNonce: 1 },
  { id: "hat", type: "rectangle", x: 150, y: 50, width: 60, height: 40, version: 7, versionNonce: 2 },
];

const fighters = [{ model: "clef" as const, name: "Clef" }, { model: "clef-flash" as const, name: "Clef Flash" }];
const add = (side: number, turn: number, n: number): LogEntry => ({
  side, turn, ops: [{ op: "add", element: { id: `${side}-${n}`, type: "ellipse", x: side * 350 + 20 * n, y: 20, width: 30, height: 30, backgroundColor: "#e03131" } }],
});
const replay: MatchState = {
  id: "m-1791810759744", prompt: "a very long cat", fighters, turns: 3, turn: 3, startedAt: 0, scenes: [[], []], nextId: [1, 1],
  log: [add(0, 1, 1), add(1, 1, 1), add(0, 2, 2), { side: 1, turn: 2, ops: [{ op: "delete", id: "1-1" }] }, add(0, 3, 3), add(1, 3, 2)],
};

/** The site, faked: replays from memory, and a live socket the test drives. */
class FakeFeed extends Feed {
  hear?: (m: unknown) => void;
  constructor(ok = true) {
    super("https://site", (async (url: string) =>
      !ok ? new Response("<html>", { status: 404 })
      : url.endsWith("/api/matches") ? Response.json([{ id: replay.id, prompt: replay.prompt, fighters, shapes: [3, 1] }])
      : Response.json(replay)) as unknown as typeof fetch);
  }
  override listen(fn: (m: never) => void) {
    this.hear = fn as (m: unknown) => void;
    return () => (this.hear = undefined);
  }
}

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 12, h, m, s);

describe("the hour", () => {
  test("slides most of it, lead-up at :55, the fight from :00", () => {
    const none = { started: false };
    expect(phaseAt(at(10, 30), none)).toBe("slides");
    expect(phaseAt(at(10, 55), none)).toBe("leadup");
    expect(phaseAt(at(11, 0), none)).toBe("fight");
    expect(phaseAt(at(11, 7), none)).toBe("fight"); // the cron's late, keep waiting
    expect(phaseAt(at(11, 8), none)).toBe("slides"); // it never came
  });

  test("back to slides at :05, or a minute after a late fight ends", () => {
    expect(phaseAt(at(11, 4), { started: true, endedAt: at(11, 3) })).toBe("fight");
    expect(phaseAt(at(11, 5), { started: true, endedAt: at(11, 3) })).toBe("slides");
    expect(phaseAt(at(11, 7, 30), { started: true, endedAt: at(11, 7) })).toBe("fight");
    expect(phaseAt(at(11, 8, 1), { started: true, endedAt: at(11, 7) })).toBe("slides");
    expect(phaseAt(at(11, 20), { started: true })).toBe("slides"); // never heard the end
  });
});

describe("the curtain", () => {
  test("hides the drawing and brings it back, even after a restart", () => {
    const b = board(drawing());
    new Curtain(b).close();
    expect(b.live()).toEqual([]);
    expect(b.map.get("hat")!.version).toBe(8);
    const later = new Curtain(b); // a new office process
    expect(later.down).toBe(true);
    later.open();
    expect(b.live().map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    expect(b.map.get("hat")!.version).toBe(9);
    expect(later.down).toBe(false);
  });

  test("brings back what a browser bumped while it was hidden", () => {
    const b = board(drawing());
    const c = new Curtain(b);
    c.close();
    b.put([{ ...b.map.get("cat")!, index: "a5", version: 9, versionNonce: 5 }]); // re-numbered, still deleted
    c.open();
    expect(b.live().map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    expect(b.map.get("cat")!.version).toBe(10);
  });

  test("leaves alone what someone already brought back", () => {
    const b = board(drawing());
    const c = new Curtain(b);
    c.close();
    b.put([{ ...b.map.get("cat")!, isDeleted: false, x: 999, version: 20, versionNonce: 5 }]); // undid it and moved it
    c.open();
    expect(b.map.get("cat")).toMatchObject({ x: 999, version: 20 });
  });
});

describe("a floor's board", () => {
  test("replays a fight beside the drawing, turn by turn, reusing its ids", async () => {
    const b = board(drawing());
    let now = at(10, 20);
    const fb = new FloorBrawl(b, new FakeFeed(), () => now);
    for (let i = 0; i < 3; i++) await fb.tick(), (now += 1_500);
    const ours = b.live().filter((e) => e.id.startsWith(PREFIX));
    expect(ours.map((e) => e.id).sort()).toEqual([`${PREFIX}0-1`, `${PREFIX}0-2`, `${PREFIX}0-3`, `${PREFIX}1-2`, `${PREFIX}arena-divider`, `${PREFIX}arena-frame`, `${PREFIX}arena-title`]);
    // beside the drawing (it ends at x 300), not on it, and locked
    expect(Math.min(...ours.map((e) => e.x!))).toBeGreaterThan(300);
    expect(ours.every((e) => e.locked)).toBe(true);
    expect(b.live().filter((e) => !e.id.startsWith(PREFIX)).length).toBe(2);
    // the next loop of the same fight reuses the same elements
    const count = b.map.size;
    now += 25_000;
    for (let i = 0; i < 4; i++) await fb.tick(), (now += 1_500);
    expect(b.map.size).toBe(count);
  });

  test("nobody on the floor: no slideshow churn", async () => {
    const b = board(drawing(), false);
    await new FloorBrawl(b, new FakeFeed(), () => at(10, 20)).tick();
    expect(b.sent.flat().length).toBe(0);
  });

  test(":55 clears the board for the arena, :00 plays the fight live, and the drawing comes back after", async () => {
    const b = board(drawing());
    const feed = new FakeFeed();
    let now = at(10, 55);
    const fb = new FloorBrawl(b, feed, () => now);
    await fb.tick();
    expect(b.live().map((e) => e.id).sort()).toEqual([`${PREFIX}arena-frame`, `${PREFIX}arena-title`]);
    expect(String(b.map.get(`${PREFIX}arena-title`)!.text)).toContain("on the hour");

    now = at(11, 0, 30);
    await fb.tick();
    const match = { ...replay, turn: 0, scenes: [[], []] };
    feed.hear!({ t: "start", match });
    feed.hear!({ t: "turn", id: replay.id, turn: 1, entries: replay.log.filter((e) => e.turn === 1) });
    expect(b.live().filter((e) => /^xb-\d-/.test(e.id)).length).toBe(2);
    expect(String(b.map.get(`${PREFIX}arena-title`)!.text)).toContain("live, turn 1/3");

    now = at(11, 4);
    feed.hear!({ t: "end", id: replay.id });
    await fb.tick();
    expect(String(b.map.get(`${PREFIX}arena-title`)!.text)).toContain("final");

    now = at(11, 5, 1);
    await fb.tick();
    expect(b.live().filter((e) => !e.id.startsWith(PREFIX)).map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    // and the slideshow is back, beside the drawing again
    expect(String(b.map.get(`${PREFIX}arena-title`)!.text)).toContain("replay, turn 1/3");
    expect(Math.min(...b.live().filter((e) => e.id.startsWith(PREFIX)).map((e) => e.x!))).toBeGreaterThan(300);
    expect(feed.hear).toBeUndefined(); // socket let go

    // and it stays that way for the rest of the hour
    for (const t of [at(11, 5, 2), at(11, 6), at(11, 7, 59), at(11, 30)]) {
      now = t;
      await fb.tick();
      expect(b.live().filter((e) => !e.id.startsWith(PREFIX)).map((e) => e.id).sort()).toEqual(["cat", "hat"]);
      expect(String(b.map.get(`${PREFIX}arena-title`)!.text)).toContain("replay");
    }
  });

  test("a fight that never came gives the board back at :08, for the rest of the hour", async () => {
    const b = board(drawing());
    let now = at(10, 58);
    const fb = new FloorBrawl(b, new FakeFeed(), () => now);
    await fb.tick();
    expect(b.live().filter((e) => !e.id.startsWith(PREFIX))).toEqual([]);
    for (const t of [at(11, 7, 59), at(11, 8), at(11, 8, 2), at(11, 40)]) {
      now = t;
      await fb.tick();
    }
    expect(b.live().filter((e) => !e.id.startsWith(PREFIX)).map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    now = at(11, 55); // the next hour's lead-up hides it again
    await fb.tick();
    expect(b.live().filter((e) => !e.id.startsWith(PREFIX))).toEqual([]);
  });

  test("a site without the replays API is left alone at :55", async () => {
    const b = board(drawing());
    await new FloorBrawl(b, new FakeFeed(false), () => at(10, 56)).tick();
    expect(b.live().map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    expect(b.sent.flat().length).toBe(0);
  });

  test("an office restart mid-fight brings the drawing back first", async () => {
    const b = board(drawing());
    new Curtain(b).close();
    const fb = new FloorBrawl(b, new FakeFeed(), () => at(10, 30)).start(60_000);
    expect(b.live().map((e) => e.id).sort()).toEqual(["cat", "hat"]);
    fb.stop();
  });
});

describe("the stack", () => {
  test("ours sort above people's indices, in the order they were drawn", () => {
    const keys = [0, 1, 61, 62, 3843, 3844, 238_327].map(stackIndex);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k > "bzz" && /^c[0-9A-Za-z]{3}$/.test(k))).toBe(true);
  });

  test("the frame goes under the fight", async () => {
    const b = board();
    const fb = new FloorBrawl(b, new FakeFeed(), () => at(10, 20));
    await fb.tick();
    const idx = (id: string) => String(b.map.get(`${PREFIX}${id}`)!.index);
    expect(idx("arena-frame") < idx("0-1")).toBe(true);
    expect(idx("arena-divider") < idx("0-1")).toBe(true);
  });
});
