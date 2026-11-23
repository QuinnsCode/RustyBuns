// A Q pedal or a sound wall module from its board file to what a fab needs (ANALOG.md
// section 8, WALL.md): renders circuits/q-<pedal>.tsx or wall-<module>.tsx in tscircuit
// (packed, autorouted, its DRC run), then writes into circuits/<board>/:
//   gerbers/        the copper, mask, silkscreen, outline and drill files
//   bom.csv         the parts list
//   pnp.csv         pick-and-place, for an assembled order
//   pcb.svg         the board, top view
//   drill.svg       a pedal's drill template for a 125B box, holes from the board's own knobs;
//                   a module's front panel (circuits/wall-panels.ts, where its jacks and pots sit)
// and circuits/<board>.circuit.json (the schematic the sim plays). The box every pedal
// shares (supply, bias, Level, LED, jacks, footswitch) is circuits/q-box.tsx; what every
// module shares (Eurorack power, jacks, pots) is circuits/wall-kit.tsx.
//   bun scripts/pcb.ts              every pedal and module (installs tscircuit in a scratch folder the first time)
//   bun scripts/pcb.ts fuzz dist    just these (`q-fuzz` works too)
//   bun scripts/pcb.ts wall         every module; `vco` or `wall-vco` one
// tscircuit pins zod 3, so it never enters the workspace: it runs in
// $FM_DAW_PCB_DIR (default: the temp folder), and so does the Gerber exporter,
// which needs a newer tscircuit helper than tscircuit itself pins.
// Exits 1 on any placement, routing or DRC error on any board.
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { drillHoles, drillSvg, panelSvg } from "../src/circuit/enclosure.ts";
import { panel } from "../circuits/wall-panels.ts";
import { arr, check, num, obj, raw, str } from "@rustybuns/util/guard";

help(import.meta.path);
const app = join(import.meta.dir, "..");
const circuits = join(app, "circuits");
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
  writeFileSync(join(dir, "run.tsx"), script);
  const r = Bun.spawnSync(["bun", "run.tsx"], { cwd: dir, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
}

const render = folder("render", {
  tscircuit: "0.0.2565", react: "19.3.1", "circuit-to-svg": "0.0.422",
  "circuit-json-to-bom-csv": "0.0.26", "circuit-json-to-pnp-csv": "0.0.16", "@tscircuit/circuit-json-util": "0.0.114", "@tscircuit/checks": "0.0.198",
});
const gerber = folder("gerber", { "circuit-json-to-gerber": "0.0.122" });

// Every q-*.tsx but the shared box is a pedal, every wall-*.tsx but the kit a module; copy them all (and the
// panels the modules read), since each imports its box or kit.
const files = readdirSync(circuits).filter((f) => /^(q|wall)-.*\.tsx?$/.test(f));
for (const f of files) cpSync(join(circuits, f), join(render, f));
const all = files.filter((f) => f.endsWith(".tsx")).map((f) => f.slice(0, -4)).filter((id) => id !== "q-box" && id !== "wall-kit");
const asked = process.argv.slice(2).flatMap((a) => a === "wall" ? all.filter((id) => id.startsWith("wall-")) : [a.startsWith("q-") || a.startsWith("wall-") ? a : all.includes(`q-${a}`) ? `q-${a}` : `wall-${a}`]);
for (const a of asked) if (!all.includes(a)) { console.error(`${a}: no circuits/${a}.tsx (boards: ${all.join(", ")})`); process.exit(1); }
let failed = 0;
for (const id of asked.length ? asked : all) failed += await pcb(id);
if (failed) process.exit(1);

/** One pedal: render, export, drill template. The number of errors. */
async function pcb(id: string): Promise<number> {
  const out = join(circuits, id), json = join(scratch, `${id}.circuit.json`);
  const module = id.startsWith("wall-") ? panel(id.slice(5)) : null;
  const title = module ? module.name : id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  console.log(`${title}:`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "gerbers"), { recursive: true });
  run(render, `
import { Circuit } from "tscircuit";
import { runAllChecks } from "@tscircuit/checks";
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg";
import { convertBomRowsToCsv, convertCircuitJsonToBomRows } from "circuit-json-to-bom-csv";
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv";
import board from "./${id}.tsx";
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
  await Bun.write(join(circuits, `${id}.circuit.json`), JSON.stringify(els.filter((e) => keep.has(check(obj({ type: str(80) }), e)?.type ?? "")), null, 1) + "\n");

  if (module) {
    const wrong = powerColumns(els);
    if (wrong) { console.log("  " + wrong); return errors.length + 1; }
    // A module's panel parts sit where its panel says (wall-panels.ts), so the template is drawn from that.
    await Bun.write(join(out, "drill.svg"), panelSvg(module));
    console.log(`drill.svg: ${module.hp} HP panel, ${module.jacks.length} jacks, ${module.knobs.length} knobs`);
    return errors.length;
  }
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
  await Bun.write(join(out, "drill.svg"), drillSvg(holes, `${title}, 125B box`));
  console.log(`drill.svg: ${holes.map((h) => `${h.name} ${h.face} (${h.x.toFixed(1)}, ${h.y.toFixed(1)})`).join(", ")}`);
  return errors.length;
}

/**
 * Why a module's power header would burn it, or null: on a Eurorack ribbon -12 V is the two pins of one end
 * column and +12 V the two of the other, so JP1's N1/N2 pads must share an x at one end and P1/P2 at the other.
 */
function powerColumns(els: unknown[]): string | null {
  const Comp = obj({ type: str(80), name: str(80), source_component_id: str(200) });
  const Port = obj({ type: str(80), name: str(80), source_port_id: str(200), source_component_id: str(200) });
  const PcbPort = obj({ type: str(80), source_port_id: str(200), x: num(-1e4, 1e4) });
  const jp = els.flatMap((e) => { const c = check(Comp, e); return c?.type === "source_component" && c.name === "JP1" ? [c.source_component_id] : []; })[0];
  const ports = els.flatMap((e) => { const q = check(Port, e); return q?.type === "source_port" && q.source_component_id === jp ? [q] : []; });
  const x = (name: string) => { const q = ports.find((r) => r.name === name); const at = q && els.map((e) => check(PcbPort, e)).find((r) => r?.type === "pcb_port" && r.source_port_id === q.source_port_id); return at?.x ?? NaN; };
  const xs = ports.map((q) => x(q.name)), lo = Math.min(...xs), hi = Math.max(...xs), near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const ok = near(x("N1"), x("N2")) && near(x("P1"), x("P2")) && ((near(x("N1"), lo) && near(x("P1"), hi)) || (near(x("N1"), hi) && near(x("P1"), lo)));
  return ok ? null : `power_header_error: JP1's -12 V (N1 ${x("N1")}, N2 ${x("N2")}) and +12 V (P1 ${x("P1")}, P2 ${x("P2")}) aren't its two end columns`;
}
