// Q Builder's PCB mockup reads the kits' own Gerbers and drill files (src/kit/gerber.ts). Every hole a fab drills
// lands on a copper pad, the board is the size Edge_Cuts says, and the bottom is the top mirrored. A layer with
// something the reader doesn't draw (arcs here) says so instead of drawing it wrong.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mockup, readDrill, readGerber } from "../src/kit/gerber.ts";

const kitOf = (id: string) => {
  const dir = join(import.meta.dir, "..", "circuits", id, "gerbers"), kit: Record<string, string> = {};
  for (const f of readdirSync(dir)) kit[`gerbers/${f}`] = readFileSync(join(dir, f), "utf8");
  return kit;
};

// Every pedal on Q Amp has a kit, so Build it has a board for each.
const KITS = ["q-fuzz", "q-drive", "q-dist", "q-squeeze", "q-germ", "q-octave", "q-phase", "q-vibe", "q-trem", "q-wah", "q-envelope"];

test.each(KITS)("%s: the board from its Gerbers, every hole on a pad", (id) => {
  const kit = kitOf(id);
  const top = mockup(kit, "top")!, bottom = mockup(kit, "bottom")!;
  expect(top.size).toEqual([58, 68]);
  expect(top.unread).toEqual([]);
  expect(top.holes).toBeGreaterThan(50);
  expect(bottom.holes).toBe(top.holes);

  const drill = readDrill(kit["gerbers/drill-L1-L2.drl"]!), pads = readGerber(kit["gerbers/F_Cu.gbr"]!).marks.flatMap((m) => (m.t === "flash" ? [m] : []));
  const parts = drill.filter((h) => h.d >= 0.5); // vias are copper too, but drawn as short traces, not flashed pads
  for (const h of parts) {
    const pad = pads.find((p) => Math.hypot(p.x - h.x, p.y - h.y) < 0.01);
    expect(pad).toBeDefined();
    const size = pad!.ap.shape === "C" ? pad!.ap.d : Math.min(pad!.ap.w, pad!.ap.h);
    expect(size).toBeGreaterThan(h.d); // copper left round the hole to solder to
  }

  // Seen from below, a hole at x from the left edge is that far from the right.
  const cx = (svg: string) => [...svg.matchAll(/<g class="pcb-holes">(.*?)<\/g>/g)][0]![1].match(/cx="([-\d.]+)"/g)!.map((s) => Number(s.slice(4, -1)));
  const a = cx(top.svg), b = cx(bottom.svg);
  a.forEach((x, i) => expect(x + b[i]).toBeCloseTo(58, 2));
});

test("a layer with arcs or regions names them instead of drawing them wrong", () => {
  const l = readGerber("%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\nX0Y0D02*\nG02X1000000Y0I500000J0D01*\nG36*\nX0Y0D02*\nG37*\nM02*");
  expect(l.unread.sort()).toEqual(["arcs", "regions"]);
  expect(mockup({})).toBeNull(); // no board files yet
});
