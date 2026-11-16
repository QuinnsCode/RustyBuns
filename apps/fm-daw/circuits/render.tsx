// Renders one board: `bun render.tsx <board.tsx> <out prefix>`. It runs inside a
// scratch folder with tscircuit installed (scripts/boards.ts sets that up: tscircuit
// pins zod 3 and stays out of the workspace), and writes three files the app reads:
//   <prefix>.circuit.json  the board's source_* elements, the netlist (src/circuit/tscircuit.ts)
//   <prefix>.schematic.svg and <prefix>.pcb.svg, each part's group tagged data-part="R1"
// The SVGs lose their own <style> and size so the board view (src/amp/board.ts) styles them.
import { Circuit } from "tscircuit";
import { convertCircuitJsonToPcbSvg, convertCircuitJsonToSchematicSvg } from "circuit-to-svg";

const [file, prefix] = process.argv.slice(2);
const { default: Board } = await import(file);
const circuit = new Circuit();
circuit.add(<Board />);
circuit.render();
const json = circuit.getCircuitJson();
const errors = json.filter((e) => e.type.endsWith("_error"));
if (errors.length) throw new Error(`${file}: ${errors.map((e) => `${e.type} ${"message" in e ? String(e.message) : ""}`).join("; ")}`);

const keep = new Set(["source_component", "source_port", "source_net", "source_trace"]);
await Bun.write(`${prefix}.circuit.json`, JSON.stringify(json.filter((e) => keep.has(e.type)), null, 1) + "\n");

const name = new Map<string, string>();
const parts = { schematic: new Map<string, string>(), pcb: new Map<string, string>() };
for (const e of json) if (e.type === "source_component") name.set(e.source_component_id, e.name);
for (const e of json) {
  if (e.type === "schematic_component") parts.schematic.set(e.schematic_component_id, name.get(e.source_component_id) ?? "");
  if (e.type === "pcb_component") parts.pcb.set(e.pcb_component_id, name.get(e.source_component_id) ?? "");
}
const tidy = (svg: string, kind: "schematic" | "pcb") => {
  const ids = parts[kind];
  return svg
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/^<svg([^>]*?) width="([\d.]+)" height="([\d.]+)"/, `<svg$1 viewBox="0 0 $2 $3"`)
    .replace(/ style="background-color:[^"]*"/, "")
    .replace(new RegExp(`data-${kind}-component-id="([^"]+)"`, "g"), (m, id) => (ids.get(id) ? `${m} data-part="${ids.get(id)}"` : m));
};
await Bun.write(`${prefix}.schematic.svg`, tidy(convertCircuitJsonToSchematicSvg(json), "schematic") + "\n");
await Bun.write(`${prefix}.pcb.svg`, tidy(convertCircuitJsonToPcbSvg(json), "pcb") + "\n");
console.log(`${prefix}: ${name.size} parts`);
