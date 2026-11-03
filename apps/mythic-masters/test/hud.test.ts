import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { bot } from "../src/bot.ts";
import { newMemory, remember, viewOf, type HudSkin } from "../src/hud/skin.ts";
import { cells } from "../src/hud/skins/21-stocks.ts";
import { creature } from "../src/roster.ts";
import { newMatch, step } from "../src/sim.ts";

// Every HUD skin in src/hud/skins/ (the page finds them with import.meta.glob; the test reads the folder).
const dir = new URL("../src/hud/skins/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
const skins = await Promise.all(files.map(async (f) => [f, ((await import(new URL(f, dir).href)) as { skin: HudSkin }).skin] as const));

// A real bot fight, played until a hit lands on someone below 60% health, then the view a frame of it gets.
function fight() {
  const m = newMatch(creature("jackalope"), creature("hodag")), mem = newMemory(), bots = [bot(0, 3), bot(1, 4)];
  for (let hurt = false; !m.over && m.tick < 60 * 60 && !(hurt && m.events.some((e) => e.kind === "hit"));) { step(m, [bots[0]!(m), bots[1]!(m)]); remember(mem, m); hurt = m.f.some((f) => f.hp < f.b.hp * 0.6); }
  return { m, mem };
}
const extras = { art: (id: string) => `/art/${id}.jpg`, tier: () => "common" as const, chargeKey: "I", bind: null };

describe("fight HUD skins", () => {
  test("a bot fight's view carries the hits and who is ahead", () => {
    const { m, mem } = fight(), v = viewOf(m, mem, extras);
    expect(v.sides.some((s) => s.hp < s.hpMax)).toBe(true);
    expect(v.hits.length).toBeGreaterThan(0);
    expect(v.hits.every((h) => h.age >= 0 && h.age <= 120)).toBe(true);
    expect(v.clock).toBeLessThan(99);
  });

  test.each(skins)("%s: its id matches its file, its CSS stays scoped, and it draws a fight and a bind", (file, s) => {
    expect(file).toMatch(new RegExp(`^\\d\\d-${s.id}\\.ts$`));
    const rules = s.css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@(media|supports|container)[^{]*\{/g, "").split("}").map((r) => r.split("{")[0]!.trim()).filter((sel) => sel && !sel.startsWith("@") && !/^(from|to|\d+%)/.test(sel));
    for (const sel of rules) for (const part of sel.split(",")) expect(part.trim()).toStartWith(`.hud[data-skin="${s.id}"]`);
    const { m, mem } = fight();
    expect(s.render(viewOf(m, mem, extras)).length).toBeGreaterThan(0);
    const bind = s.render(viewOf(m, mem, { ...extras, art: () => null, bind: { chance: 0.42, ink: 2, key: "B", note: "wear it down first" } }));
    expect(bind).toContain("42%");
  });

  test("the chunk a hit takes off trails behind the HP bar, then drains to meet it", () => {
    const { m, mem } = fight(), hurt = m.events.find((e) => e.kind === "hit" && !e.guarded && e.damage > 0);
    expect(hurt?.kind).toBe("hit");
    const on = hurt!.kind === "hit" ? hurt!.on : 0, side = () => viewOf(m, mem, extras).sides[on];
    expect(side().hpTrail).toBeGreaterThan(side().hp);
    m.events = [];
    for (let i = 0; i < 60 * 2; i++) remember(mem, m);
    expect(side().hpTrail).toBe(side().hp);
  });

  test.each([[0, [0, 0, 0, 0]], [37.5, [1, 0.5, 0, 0]], [100, [1, 1, 1, 1]], [120, [1, 1, 1, 1]]] as const)("stocks: %d energy fills its four cells as %p", (e, want) => {
    expect(cells(e, 100)).toEqual([...want]);
  });
});
