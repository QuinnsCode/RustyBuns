import { describe, expect, test } from "bun:test";
import { abduction, arrival, Director, faceoff, FACEOFF, freeze, HOVER, introClock, lookout, PINES, SCENES, trail } from "../src/director.ts";
import { identified, intro, type Subject } from "../src/casefile.ts";
import INTRO from "../content/intro.json";
/** A line of content/intro.json as the caption shows it, whatever the writer made it say. */
const heard = (say: string) => say.slice(say.indexOf(":") + 1).trim();

const at = { x: 100, y: 4, z: -50 }, view = { x: 100, y: 120, z: -1050 };
/** Steps the director `s` seconds at 60 frames a second; what was said on the way. */
function run(d: Director, s: number, skipAt = -1) {
  const said: string[] = [];
  for (let i = 0; i < Math.round(s * 60); i++) {
    d.step(1 / 60, i === skipAt);
    const c = d.stage.caption, line = c && `${c.who}: ${c.text}`;
    if (line && said.at(-1) !== line) said.push(line);
  }
  return said;
}

const wampus: Subject = { id: "wampus-cat", name: "Wampus Cat", sub: "Keeper of Batsto Village · Lv 2", kind: "keeper", known: "new", bound: 0, place: "Batsto Village",
  region: "Pine Barrens", tier: "uncommon", heightM: 1.2, massKg: 70, signature: "Firelight Prowl", origin: "Appalachian settler tales. More." };

describe("the director", () => {
  test("the intro's lines, however long the writer made them in content/intro.json, each stay up long enough to read", () => {
    const s = abduction({ x: 0, y: 0, z: 0 });
    s.lines.forEach(([t, line], i) => {
      const until = s.lines[i + 1]?.[0] ?? s.seconds;
      expect(until - t).toBeGreaterThanOrEqual(line.slice(line.indexOf(":") + 1).trim().length / 15);
    });
  });

  test("a new journey: you come to twice, the greys go up the beam, a standoff waits its turn, then a freeze frame", () => {
    const d = new Director();
    d.play(abduction(at));
    // A keeper walked into mid-scene waits behind it.
    d.play(intro({ ...wampus, known: "known" }, at, 1.2, 0));
    // Strapped in the saucer: your eyes open on the room, blurry, and the greys panic.
    const { real, seconds } = introClock(); // moments below are on the scene's script; long lines stretch it
    const ship = run(d, real(5));
    expect(d.beat?.id).toBe("abduction");
    expect(d.holding).toBe(true);
    expect(d.stage.pov).toMatchObject({ where: "ship" });
    expect(d.stage.pov!.lids).toBeGreaterThan(0.9);
    expect(d.stage.saucer).toBeNull();
    expect(ship.some((l) => l.includes(heard(INTRO.inTheSaucer[0]!.say)))).toBe(true);
    // Put back under: the lids close.
    run(d, real(12.5) - real(5));
    expect(d.stage.pov!.lids).toBeLessThan(0.05);
    // On your back in the pines: the camera on the ground looking up, the greys over you, the saucer waiting.
    const pines = run(d, real(33) - real(12.5));
    expect(PINES).toBeLessThan(33);
    expect(d.stage.pov).toMatchObject({ where: "pines" });
    expect(d.stage.pov!.figures).toBeGreaterThan(0.9);
    expect(d.stage.shot!.from.y).toBeLessThan(at.y + 0.5);
    expect(d.stage.shot!.at.y).toBeGreaterThan(at.y + 10);
    expect(d.stage.saucer!.y).toBeGreaterThan(at.y + HOVER - 1);
    expect(pines.some((l) => l.includes(heard(INTRO.inThePines[0]!.say)))).toBe(true);
    // Called home: up the beam they go.
    run(d, real(34.5) - real(33));
    expect(d.stage.saucer!.beam).toBeGreaterThan(0.9);
    expect(d.stage.pov!.up).toBeGreaterThan(0);
    const said = run(d, seconds - real(34.5) - 0.1);
    expect(said.some((l) => l.startsWith("Book:"))).toBe(true);
    run(d, 0.2);
    // Then the keeper: its name slams in while the fight waits.
    expect(d.beat?.id).toBe("standoff");
    run(d, 0.5);
    expect(d.stage.title?.text).toBe("Wampus Cat");
    expect(d.stage.bars).toBeGreaterThan(0.9);
    // Any key cuts it to its last moment; the camera has handed the view back by the end.
    run(d, 0.1, 0);
    run(d, 0.5);
    expect(d.beat).toBeNull();
    expect(d.holding).toBe(false);
    expect(d.stage.shot).toBeNull();
    // It goes down: freeze frame, a slow turn, the line, and nothing after.
    d.play(freeze("won", at, 0));
    run(d, 0.5);
    expect(d.stage.freeze).toBe(1);
    expect(d.stage.caption?.text).toMatch(/\w/);
    run(d, 3);
    expect(d.beat).toBeNull();
    expect(d.stage.freeze).toBe(0);
  });

  test("the trail talks without holding you, a held scene cuts it off, and a gag tells once", () => {
    const d = new Director();
    d.play(trail("pine-barrens", 1));
    run(d, 1);
    expect(d.holding).toBe(false);
    expect(d.stage.caption?.text).toContain("tea");
    // A busy director drops another line on the trail.
    expect(d.play(trail("pine-barrens", 2))).toBe(false);
    expect(d.play(arrival(3, at, view))).toBe(true);
    expect(d.beat?.id).toBe("arrival");
    expect(d.stage.caption).toBeNull();
    run(d, 7.9);
    expect(d.gag("inkSpent")).toBe(true);
    run(d, 3.1);
    expect(d.gag("inkSpent")).toBe(false);
  });

  test("a creature you don't know is drowned out; one you know gets a file as loud as everything you know", () => {
    // [how well you know it, creatures bound] -> what the intro shows by its last second.
    const cases: [Subject["known"], number, { muffled: boolean; name: string; rows: number; stamps: string[] }][] = [
      ["new", 0, { muffled: true, name: "██████ ███", rows: 0, stamps: [] }],
      ["new", 9, { muffled: true, name: "██████ ███", rows: 3, stamps: ["UNIDENTIFIED"] }],
      ["met", 0, { muffled: true, name: "W█████ C██", rows: 0, stamps: [] }],
      ["known", 0, { muffled: false, name: "Wampus Cat", rows: 0, stamps: [] }],
      ["known", 3, { muffled: false, name: "Wampus Cat", rows: 2, stamps: ["CONFIRMED"] }],
      ["known", 8, { muffled: false, name: "Wampus Cat", rows: 6, stamps: ["CONFIRMED", "EYES ONLY"] }],
      ["known", 40, { muffled: false, name: "Wampus Cat", rows: 12, stamps: ["CONFIRMED", "EYES ONLY", "MEMETIC HAZARD", "DO NOT ENGAGE", "ENGAGE ANYWAY"] }],
    ];
    for (const [known, bound, want] of cases) {
      const d = new Director(), s = intro({ ...wampus, known, bound }, at, 1.2, 0);
      d.play(s);
      const said = run(d, s.seconds - 0.6);
      expect(said[0]).toContain("Are we alright?");
      expect(d.stage.title?.text).toBe(want.name);
      expect(d.stage.muffle > 0.5).toBe(want.muffled);
      if (want.muffled) expect(said.some((l) => l.startsWith("???:") && l.includes("you don't know what that is yet"))).toBe(true);
      expect(d.stage.file?.rows.length ?? 0).toBe(want.rows);
      expect(d.stage.file?.stamps ?? []).toEqual(want.stamps);
    }
  });

  test("binding the first of a kind lifts the bars and clears the noise, and says when your clearance goes up", () => {
    for (const [bound, raised] of [[3, true], [4, false]] as const) {
      const d = new Director(), s = identified("wampus-cat", "Wampus Cat", bound, at, 0);
      d.play(s);
      run(d, 0.6);
      expect(d.stage.muffle).toBeGreaterThan(0.4);
      expect(d.stage.title?.text).toContain("█");
      const said = run(d, s.seconds - 1);
      expect(d.stage.muffle).toBe(0);
      expect(d.stage.title?.text).toBe("Wampus Cat");
      expect(d.stage.file?.stamps).toEqual(raised ? ["IDENTIFIED", "CLEARANCE RAISED"] : ["IDENTIFIED"]);
      expect(said.some((l) => l.includes("Clearance raised: field notes"))).toBe(raised);
    }
  });

  test("a fight's start: the standoff, then the cards meet at the middle while the camera spirals down, and the bars slide back in", () => {
    const d = new Director(), jack = { name: "Jackalope", sub: "Common", art: "/art/jackalope.jpg", tier: "common" }, hodag = { name: "Hodag", sub: "Rare", art: null, tier: "rare" };
    d.play(intro({ ...wampus, known: "known" }, at, 1.2, 0));
    d.play(faceoff(jack, hodag, at));
    run(d, 0.5);
    expect([d.beat?.id, d.stage.versus, d.stage.hud < 0.2]).toEqual(["standoff", null, true]);
    while (d.beat?.id === "standoff") run(d, 0.1);
    run(d, 1.2);
    // Met at the middle, VS up, the HUD still off, the camera high over the arena and in charge of the view.
    expect([d.beat?.id, d.stage.versus?.in, d.stage.versus?.vs, d.stage.versus?.b.name, d.holding, d.stage.hud]).toEqual(["faceoff", 1, 1, "Hodag", true, 0]);
    const high = d.stage.shot!.from.y;
    expect([high > at.y + 6, d.stage.shot!.mix]).toEqual([true, 1]);
    run(d, FACEOFF - 1.3);
    // Down low by the end, the cards gone, the bars back, and the fight let go.
    expect(d.stage.shot === null || d.stage.shot.from.y < high).toBe(true);
    run(d, 0.3);
    expect([d.beat, d.holding, d.stage.versus, d.stage.hud]).toEqual([null, false, null, 1]);
  });

  test("any key cuts the faceoff short", () => {
    const d = new Director();
    d.play(faceoff({ name: "A", sub: "", art: null, tier: "common" }, { name: "B", sub: "", art: null, tier: "common" }, at));
    run(d, 0.8, 10);
    expect(d.holding).toBe(false);
  });

  test("a new region: the camera slides past you with the hills behind, whips round, and cranes up to show them", () => {
    const d = new Director();
    d.play(arrival(2, at, view));
    run(d, 0.5);
    const a = d.stage.shot!;
    run(d, 2);
    const b = d.stage.shot!;
    // The slide: sideways (across the line to the hills, which run north), low, the lens long, looking toward them.
    expect(Math.abs(b.from.x - a.from.x)).toBeGreaterThan(3);
    expect(Math.abs(b.from.z - a.from.z)).toBeLessThan(0.5);
    expect([b.from.z > at.z, b.from.y < at.y + 2, b.fov! < 40]).toEqual([true, true, true]);
    // The join is a whip: the picture blurs halfway through it.
    run(d, 1.1);
    expect(d.stage.whip).toBeGreaterThan(0.6);
    // Then up over your shoulder, looking out at the hills, and the view handed back by the end.
    run(d, 2.5);
    expect(d.stage.shot!.from.y).toBeGreaterThan(at.y + 4);
    expect(d.stage.shot!.at.z).toBeLessThan(d.stage.shot!.from.z - 10);
    run(d, 2);
    expect([d.beat, d.stage.shot]).toEqual([null, null]);
  });

  test("a landmark: a flash, then time slows while the camera turns all the way round you", () => {
    const d = new Director(), s = lookout("Apple Pie Hill", at, view, 0);
    d.play(s);
    run(d, 0.4);
    expect(d.stage.caption?.text).toContain("Apple Pie Hill");
    run(d, 1.2);
    expect(d.stage.flash).toBeGreaterThan(0.5);
    // A quarter, a half and three quarters of the turn sit on three different sides of you, in slow motion.
    const sides = new Set<string>();
    for (let i = 0; i < 4; i++) { run(d, 1.2); const f = d.stage.shot!.from; sides.add(`${Math.sign(Math.round(f.x - at.x))},${Math.sign(Math.round(f.z - at.z))}`); }
    expect(sides.size).toBeGreaterThanOrEqual(3);
    expect(d.stage.slow).toBeLessThan(0.5);
    run(d, 2);
    expect([d.beat, d.stage.slow]).toEqual([null, 1]);
  });

  test("every scene plays from its name, holds still on a frame, and gives the view back", () => {
    for (const [name, make] of Object.entries(SCENES)) {
      const d = new Director(), s = make({ at, view, n: 1, k: 1, name: "Somewhere" });
      expect(d.play(s)).toBe(true);
      // Held at a second for a screenshot: nothing moves until it's let go.
      d.seek(s.seconds / 2); d.paused = true;
      const frozen = JSON.stringify(d.stage.shot);
      run(d, 1);
      expect([name, JSON.stringify(d.stage.shot)]).toEqual([name, frozen]);
      d.paused = false;
      run(d, s.seconds);
      expect([name, d.beat, d.stage.shot, d.stage.slow]).toEqual([name, null, null, 1]);
    }
  });
});
