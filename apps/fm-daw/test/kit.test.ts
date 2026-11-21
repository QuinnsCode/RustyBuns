// A pedal's build sheet as a player gets it: walk to the pedal wall, look at Q Drive, open its sheet with a germanium
// diode swapped in Q Amp, read the parts list, and download the kit. The sheet reads the kit folder's files
// (circuits/q-drive/) as the page does, here from disk instead of through Vite.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";
import { PEDALS } from "../src/circuit/amps.ts";
import { kitZip, readBom, sheetOf, type KitFiles } from "../src/kit/kit.ts";
import { toleranceBand, widest } from "../src/kit/tolerance.ts";
import { unzip, zip } from "../src/kit/zip.ts";
import { lookAt, newRoom, pedalAt, pickUp, walkTo } from "../src/room/room.ts";

setDefaultTimeout(30_000);
const CIRCUITS = join(import.meta.dir, "../circuits");
async function kitOnDisk(kit: string): Promise<KitFiles> {
  const out: KitFiles = {};
  // Keys use `/` as the page's import.meta.glob does; Bun's scan gives `gerbers\top.gtl` on Windows.
  for await (const p of new Glob("**/*").scan({ cwd: join(CIRCUITS, kit), onlyFiles: true })) out[p.replaceAll("\\", "/")] = await Bun.file(join(CIRCUITS, kit, p)).text();
  return out;
}
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

test("look at Q Drive on the pedal wall, open its build sheet with your swap, and download the kit", async () => {
  const r = newRoom();
  walkTo(r, -2.4, 0.9); walkTo(r, -2.7, -1.7);
  lookAt(r, "drive");
  const drive = pedalAt(r);
  expect(drive?.name).toBe("Q Drive");
  // A knob on it, or the pedal in your hand, is the same pedal.
  lookAt(r, "drive", "drive");
  expect(pedalAt(r)?.id).toBe("drive");
  expect(pickUp(r, "drive")).toEqual({ ok: true });
  r.you.yaw += Math.PI; // turn away: what you hold still counts
  expect(pedalAt(r)?.id).toBe("drive");

  const kit = await kitOnDisk("q-drive");
  const sheet = sheetOf(drive!, kit, { D1: "germanium", C4: "2.2" });
  expect(sheet).toMatchObject({ kit: "q-drive", made: true });
  // Every part on the board is on the list once, counted.
  expect(sheet.lines.reduce((n, l) => n + l.count, 0)).toBe(readBom(kit["bom.csv"]!).length);
  expect(sheet.lines).toContainEqual(expect.objectContaining({ part: "Resistor", value: "10k", count: 2 }));
  expect(sheet.lines).toContainEqual(expect.objectContaining({ part: "Op-amp", value: "TL071", socketed: true, swapped: false }));
  // The swapped diode pair and the bigger tone cap are the player's parts, in sockets.
  expect(sheet.lines).toContainEqual(expect.objectContaining({ part: "Diode", value: "1N34A", refs: ["D1", "D2"], socketed: true, swapped: true }));
  expect(sheet.parts.find((p) => p.ref === "C4")).toMatchObject({ value: "470n", swapped: true });

  const files = unzip(kitZip(kit, sheet.text, "<svg/>", sheet.parts));
  const layers = Object.keys(kit).filter((p) => p.startsWith("gerbers/"));
  expect(layers.length).toBeGreaterThan(5);
  for (const l of layers) expect(text(files[l])).toBe(kit[l]!);
  for (const f of ["pnp.csv", "drill.svg", "pcb.svg", "schematic.svg", "build-sheet.txt"]) expect(files[f]).toBeDefined();
  expect(text(files["bom.csv"])).toMatch(/"D2","Diode","1N34A","[^"]+","yes, your swap"/);

  // Stock parts: no swaps, nothing marked as yours.
  expect(sheetOf(drive!, kit).parts.some((p) => p.swapped)).toBe(false);
});

test("before ordering, the sheet's tolerance band says how far a build may sound from the sim, and a swap goes further", async () => {
  const drive = PEDALS.find((p) => p.id === "drive")!;
  const runs: number[] = [];
  const band = await toleranceBand(drive.net(5), { runs: 8, onRun: (done) => runs.push(done) });
  expect(runs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // The sim's mid hump, with every build around it: some below, some above, none far.
  const mid = band.hz.indexOf(905), low = band.hz.indexOf(80);
  expect(band.sim[mid] - band.sim[low]).toBeGreaterThan(6);
  band.sim.forEach((s, i) => { expect(band.lo[i]).toBeLessThanOrEqual(s); expect(band.hi[i]).toBeGreaterThanOrEqual(s); });
  expect(widest(band)).toBeGreaterThan(0.1);
  expect(widest(band)).toBeLessThan(3);
  expect(band.level.lo).toBeLessThan(0);
  expect(band.level.hi).toBeGreaterThan(0);
  // Seeded: the same pedal shows the same band each time the sheet opens.
  expect(await toleranceBand(drive.net(5), { runs: 8 })).toEqual(band);
  // Germanium in the clipper socket drops the level further than any build's parts do.
  const germ = await toleranceBand(drive.net(5, { D1: "germanium" }), { runs: 0 });
  expect(band.level.sim - germ.level.sim).toBeGreaterThan(3 * Math.max(-band.level.lo, band.level.hi));
});

test("a pedal with no kit folder has a sheet that says its fab files are not made yet", () => {
  const phase = PEDALS.find((p) => p.id === "phase")!;
  expect(sheetOf(phase, {})).toMatchObject({ kit: "q-phase", made: false, lines: [], layers: [] });
});

test("the zip writer round-trips text and bytes, and names folders by path", () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const z = zip({ "gerbers/F_Cu.gbr": "G04 top copper*\n", "a b/ü.txt": "ünïcode", "raw.bin": bytes, "empty.txt": "" });
  expect(Array.from(z.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const back = unzip(z);
  expect(Object.keys(back)).toEqual(["gerbers/F_Cu.gbr", "a b/ü.txt", "raw.bin", "empty.txt"]);
  expect(text(back["a b/ü.txt"])).toBe("ünïcode");
  expect(Array.from(back["raw.bin"]!)).toEqual([0, 1, 2, 255]);
  // The same files make the same bytes (a fixed date in every entry).
  expect(zip({ a: "x" })).toEqual(zip({ a: "x" }));
});
