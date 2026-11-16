// Q Drive from the board file to what a fab needs (ANALOG.md section 8):
// renders circuits/q-drive.tsx in tscircuit (packed, autorouted, its DRC run),
// then writes into circuits/q-drive/:
//   gerbers/        the copper, mask, silkscreen, outline and drill files
//   bom.csv         the parts list
//   pnp.csv         pick-and-place, for an assembled order
//   pcb.svg         the board, top view
//   drill.svg       a drill template for a 125B box, holes from the board's own knobs
// and circuits/q-drive.circuit.json (the schematic the test plays).
//   bun scripts/pcb.ts          render and export (installs tscircuit in a scratch folder the first time)
// tscircuit pins zod 3, so it never enters the workspace: it runs in
// $FM_DAW_PCB_DIR (default: the temp folder), and so does the Gerber exporter,
// which needs a newer tscircuit helper than tscircuit itself pins.
// Exits 1 on any placement, routing or DRC error.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { drillHoles, drillSvg } from "../src/circuit/enclosure.ts";
import { arr, check, obj, raw, str } from "@rustybuns/util/guard";

help(import.meta.path);
const app = join(import.meta.dir, "..");
const out = join(app, "circuits/q-drive");
const scratch = process.env.FM_DAW_PCB_DIR ?? join(tmpdir(), "fm-daw-pcb");

function folder(name: string, deps: Record<string, string>): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const pkg = JSON.stringify({ name: `fm-daw-pcb-${name}`, private: true, type: "module", dependencies: deps });
  const file = join(dir, "package.json");
  if (!Bun.file(join(dir, "node_modules")).size || Bun.spawnSync(["cat", file]).stdout.toString() !== pkg) {
    Bun.write(file, pkg);
    const r = Bun.spawnSync(["bun", "install"], { cwd: dir, stdout: "ignore", stderr: "inherit" });
    if (r.exitCode !== 0) throw new Error(`bun install in ${dir} failed`);
  }
  return dir;
}

function run(dir: string, script: string): void {
  Bun.write(join(dir, "run.tsx"), script);
  const r = Bun.spawnSync(["bun", "run.tsx"], { cwd: dir, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
}

const render = folder("render", {
  tscircuit: "0.0.2565", react: "19.3.1", "circuit-to-svg": "0.0.422",
  "circuit-json-to-bom-csv": "0.0.26", "circuit-json-to-pnp-csv": "0.0.16", "@tscircuit/circuit-json-util": "0.0.114", "@tscircuit/checks": "0.0.198",
});
const gerber = folder("gerber", { "circuit-json-to-gerber": "0.0.122" });
cpSync(join(app, "circuits/q-drive.tsx"), join(render, "q-drive.tsx"));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "gerbers"), { recursive: true });
const json = join(scratch, "q-drive.circuit.json");

run(render, `
import { Circuit } from "tscircuit";
import { runAllChecks } from "@tscircuit/checks";
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg";
import { convertBomRowsToCsv, convertCircuitJsonToBomRows } from "circuit-json-to-bom-csv";
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv";
import board from "./q-drive.tsx";
const c = new Circuit();
c.add(board);
await c.renderUntilSettled();
const j = c.getCircuitJson();
// The full DRC again on the routed board, on top of what render already checked.
for (const e of await runAllChecks(j)) if (e.type.endsWith("_error") && !j.some((x) => x.type === e.type && x.message === e.message)) j.push(e);
await Bun.write(${JSON.stringify(json)}, JSON.stringify(j));
await Bun.write(${JSON.stringify(join(out, "pcb.svg"))}, convertCircuitJsonToPcbSvg(j));
await Bun.write(${JSON.stringify(join(out, "bom.csv"))}, convertBomRowsToCsv(await convertCircuitJsonToBomRows({ circuitJson: j })));
await Bun.write(${JSON.stringify(join(out, "pnp.csv"))}, convertCircuitJsonToPickAndPlaceCsv(j));
`);
run(gerber, `
import { convertCircuitJsonToGerberFiles } from "circuit-json-to-gerber";
const files = convertCircuitJsonToGerberFiles(await Bun.file(${JSON.stringify(json)}).json());
for (const [name, text] of Object.entries(files)) await Bun.write(${JSON.stringify(join(out, "gerbers"))} + "/" + name, text);
console.log("gerbers", Object.keys(files).join(" "));
`);

const els = arr(raw, 100_000)(await Bun.file(json).json());
const Kind = obj({ type: str(80), message: str(2000) });
const errors = els.flatMap((e) => { const k = check(Kind, e); return k && k.type.endsWith("_error") ? [`${k.type}: ${k.message}`] : []; });
const count = (t: string) => els.filter((e) => check(obj({ type: str(80) }), e)?.type === t).length;
console.log(`parts ${count("source_component")}, traces ${count("pcb_trace")}, vias ${count("pcb_via")}, holes ${count("pcb_plated_hole")}, errors ${errors.length}`);
for (const e of errors) console.log("  " + e);

// The schematic half is what the sim reads; the layout is in the Gerbers.
const keep = new Set(["source_component", "source_port", "source_net", "source_trace"]);
await Bun.write(join(app, "circuits/q-drive.circuit.json"), JSON.stringify(els.filter((e) => keep.has(check(obj({ type: str(80) }), e)?.type ?? "")), null, 1) + "\n");

// Alpha 16 mm board-mount pots: the shaft sits about 7.5 mm from the leg row
// (check your pot's datasheet before drilling). 3PDT bushing 12 mm, jacks 10 mm, DC jack 12 mm.
const holes = drillHoles(els, {
  parts: { RV1: { drill: 7.5, shaft: 7.5 }, RV2: { drill: 7.5, shaft: 7.5 }, LED1: { drill: 5 } },
  extra: [
    { name: "FOOTSWITCH", x: 0, y: -40, drill: 12, face: "top" },
    { name: "IN", x: 30, y: 25, drill: 10, face: "right" },
    { name: "OUT", x: 30, y: 25, drill: 10, face: "left" },
    { name: "9V", x: 0, y: 20, drill: 12, face: "end" },
  ],
});
await Bun.write(join(out, "drill.svg"), drillSvg(holes, "Q Drive, 125B box"));
console.log(`drill.svg: ${holes.map((h) => `${h.name} ${h.face} (${h.x.toFixed(1)}, ${h.y.toFixed(1)})`).join(", ")}`);
if (errors.length) process.exit(1);
