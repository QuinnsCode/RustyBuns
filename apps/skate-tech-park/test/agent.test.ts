// An agent rides the board through the WebMCP tools, with the page's step loop played by a timer here.
import { expect, test } from "bun:test";
import { Driver, tools } from "../src/agent.ts";
import { plaza } from "../src/levels/plaza.ts";
import { IDLE, start, step } from "../src/sim.ts";

const game = () => {
  const driver = new Driver(), went: Record<string, unknown>[] = [];
  let sim = start(0, -40, 0, plaza);
  const loop = setInterval(() => { for (let i = 0; i < 30; i++) step(sim, { ...IDLE, ...driver.next() }, plaza); }, 1);
  const t = tools({
    driver, state: () => sim, level: plaza, park: { id: "plaza", spawns: [] }, parks: () => [{ id: "plaza", name: "Plaza" }],
    go: (park, extra) => { went.push({ park, ...extra }); }, spots: ["rail"], start: (n) => n === "rail" && ((sim = start(5, -40, 0, plaza)), true), perf: () => ({ fps: 60, frameMs: 16.7, worstMs: 20, tier: "mid", pixelRatio: 1.5 }),
    reset: () => { sim = start(0, -40, 0, plaza); }, swap: () => "roadster", snapshot: () => "data:image/png;base64,",
  });
  const call = (name: string, args: unknown = {}) => t.find((x) => x.name === name)!.execute(args);
  return { call, went, stop: () => clearInterval(loop) };
};

test("an agent pushes off, ollies and kickflips in one line, and reads the trick back", async () => {
  const g = game();
  try {
    const out = await g.call("skate_line", { moves: [{ push: 1, seconds: 2 }, { ollie: true, seconds: 0.15 }, { trick: "kickflip", seconds: 2 }] });
    if (!("tricks" in out)) throw new Error("no ride report");
    expect(out.tricks.map((t) => t.name)).toContain("kickflip");
    expect(out.now.score).toBeGreaterThan(0);
    expect(out.now.doing).toBe("rolling");

    const looked = await g.call("skate_look");
    expect("kmh" in looked && looked.kmh).toBeGreaterThan(10);
  } finally { g.stop(); }
});

test("a move it can't make is clamped or dropped, not obeyed: no trick named 'moonwalk', no push past full", async () => {
  const g = game();
  try {
    const out = await g.call("skate_ride", { push: 50, trick: "moonwalk", seconds: 1, manual: "sideways" });
    if (!("now" in out)) throw new Error("no ride report");
    expect(out.tricks).toEqual([]);
    expect(out.now.kmh).toBeLessThan(25); // one second of a full push, not fifty
    expect(await g.call("skate_go", { park: "nowhere" })).toHaveProperty("error");
  } finally { g.stop(); }
});

test("an agent jumps to a start, reads the frame time, and loads a park on a weak low tier", async () => {
  const g = game();
  try {
    expect(await g.call("skate_start", { at: "nowhere" })).toHaveProperty("error");
    const at = await g.call("skate_start", { at: "rail" });
    expect("at" in at && at.at.x).toBe(5);
    expect(await g.call("skate_perf")).toMatchObject({ tier: "mid", fps: 60 });
    await g.call("skate_go", { park: "plaza", spawn: "vert", quality: "low", controls: "touch", weak: 40, fps: true });
    await g.call("skate_go", { park: "plaza", quality: "ultra", controls: "tablet" });
    expect(g.went).toEqual([{ park: "plaza", spawn: "vert", quality: "low", controls: "touch", weak: 40, fps: true }, { park: "plaza" }]);
  } finally { g.stop(); }
});
