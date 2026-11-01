import { describe, expect, test } from "bun:test";
import { abduction, ABDUCTION, Director, freeze, HOVER, sweep, trail } from "../src/director.ts";
import { identified, intro, type Subject } from "../src/casefile.ts";

const at = { x: 100, y: 4, z: -50 };
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
  test("a new journey: the tape, the saucer, a standoff waiting its turn, then a freeze frame", () => {
    const d = new Director();
    d.play(abduction(at));
    // A keeper walked into mid-tape waits behind it.
    d.play(intro({ ...wampus, known: "known" }, at, 1.2, 0));
    run(d, 5);
    expect(d.beat?.id).toBe("abduction");
    expect(d.holding).toBe(true);
    expect(d.stage.tape).toBeCloseTo(1);
    expect(d.stage.label).toContain("TAPE 1");
    // The saucer hovers over you with its beam on, and the camera, in somebody's hands, looks up at it.
    expect(d.stage.saucer!.y).toBeGreaterThan(at.y + HOVER - 1);
    expect(d.stage.saucer!.beam).toBeGreaterThan(0.9);
    expect(d.stage.shot!.at.y).toBeGreaterThan(at.y + 10);
    const said = run(d, ABDUCTION - 5 - 0.1);
    expect(said.some((l) => l.startsWith("Totem:"))).toBe(true);
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
    expect(d.play(sweep(3, at))).toBe(true);
    expect(d.beat?.id).toBe("sweep");
    expect(d.stage.caption).toBeNull();
    run(d, 7.1);
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
});
