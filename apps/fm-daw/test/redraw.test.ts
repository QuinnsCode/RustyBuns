// A changed circuit's schematic (#6445): the stock drawing with a removed part gone and a moved end wired to its new net.
// C5 added, and a click on its wire, is in builder-page.test.ts.
import { expect, test } from "bun:test";
import { editNets } from "../src/circuit/builder.ts";
import { redraw } from "../src/circuit/redraw.ts";

const stock = await Bun.file(new URL("../circuits/fuzz.schematic.svg", import.meta.url)).text();
const net = (label: string) => editNets("fuzz").find((n) => n.label === label)!.key;
/** The corners of every wire drawn on a net. */
const wired = (svg: string, key: string) => [...svg.matchAll(/class="trace sch-trace"[^>]*map-key="([^"]*)">.*?class="sch-trace-path" d="([^"]*)"/g)]
  .filter((m) => m[1] === key).flatMap((m) => [...m[2].matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) })));
const reaches = (svg: string, key: string, at: { x: number; y: number }) => wired(svg, key).some((p) => Math.abs(p.x - at.x) < 1 && Math.abs(p.y - at.y) < 1);

test("a removed part leaves the drawing; the rest stay", () => {
  const svg = redraw(stock, "fuzz", [{ t: "remove", part: "R2" }]);
  expect(svg).not.toContain(`data-part="R2"`);
  expect(svg).toContain(`data-part="C2"`);
});

test("a moved end is wired to its new net", () => {
  // D3's cathode (source_port_24 on the stock drawing), from ground to the output.
  const m = /data-schematic-port-id="source_port_24"><circle cx="([\d.]+)" cy="([\d.]+)"/.exec(stock)!, at = { x: Number(m[1]), y: Number(m[2]) };
  expect(reaches(stock, net("OUT"), at)).toBe(false);
  expect(reaches(redraw(stock, "fuzz", [{ t: "move", part: "D3", pin: "cathode", to: net("OUT") }]), net("OUT"), at)).toBe(true);
});
