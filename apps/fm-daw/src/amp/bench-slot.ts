// The bench slot on Q Amp's floor: drop a tscircuit board's circuit JSON on the floor
// (or pick the file) and it becomes a pedal with a knob per pot, or the slot says why
// it won't play. The board and its knobs are kept in this browser, apart from the
// rest of the page's state because a board runs to tens of kilobytes.
import { check, num, obj, raw, rec, str } from "@rustybuns/util/guard";
import { bench, type Bench } from "../circuit/bench.ts";
import type { Netlist } from "@rustybuns/gear/circuit";
import { h, iconButton } from "./dom.ts";
import { knob } from "./knob.ts";

const KEY = "q-amp-bench";
const Kept = obj({ name: str(80), board: raw, knobs: rec(num(0, 10, 5), 64) });

export interface BenchSlot {
  el: HTMLElement;
  /** The board's netlist at its knobs now, or null while the slot is empty or the board won't play. */
  net(): Netlist | null;
  /** Puts a board on the bench, as a drop or the file picker does. */
  load(json: unknown, name: string): Bench;
  /** Lights the slot's LED when the bench pedal is the one on. */
  light(on: boolean): void;
  state(): { name: string; ok: boolean; why: string[]; knobs: Record<string, number>; gear: unknown } | null;
}

/** `toggle` is the footswitch; `changed` is a knob turn or a new board (the page resends its settings). */
export function benchSlot(floor: HTMLElement, o: { toggle: () => void; changed: (ok: boolean) => void }): BenchSlot {
  let kept: ReturnType<typeof Kept> | null = null;
  let result: Bench | null = null;
  try {
    const s = localStorage.getItem(KEY);
    kept = s ? check(Kept, JSON.parse(s)) : null;
  } catch { /* private window or bad JSON: an empty bench */ }

  const el = h("div", "pedal bench");
  const file = h("input");
  Object.assign(file, { type: "file", accept: ".json,application/json", hidden: true });
  file.addEventListener("change", () => { const f = file.files?.[0]; if (f) void readFile(f); file.value = ""; });
  const pick = iconButton("upload", "Put a tscircuit board on the bench (its circuit JSON)", () => file.click());

  const save = () => { try { if (kept) localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* too big or blocked: not kept, fine */ } };

  function draw() {
    el.classList.remove("empty", "broken");
    if (!kept || !result) {
      el.classList.add("empty");
      el.replaceChildren(h("span", "pedal-name", "Bench"), h("span", "bench-hint", "Drop a tscircuit board here"), pick, file);
      return;
    }
    if (!result.ok) {
      el.classList.add("broken");
      el.replaceChildren(h("span", "pedal-name", kept.name), h("span", "bench-hint", "Won't play:"), h("ul", "bench-why", ...result.why.map((w) => h("li", "", w))), pick, file);
      return;
    }
    const k = kept;
    const knobs = result.pedal.knobs.map((p) => knob(p.name, k.knobs[p.name] ?? 5, 5, (v) => { k.knobs[p.name] = v; save(); o.changed(true); }, "small").el);
    const sw = h("button", "footswitch");
    sw.type = "button"; sw.title = `${k.name} on or off`; sw.setAttribute("aria-label", `${k.name} on or off`);
    sw.addEventListener("click", o.toggle);
    el.title = result.pedal.gear.what;
    el.replaceChildren(h("span", "pedal-led"), h("div", "bench-knobs", ...knobs), h("span", "pedal-name", k.name), h("div", "bench-row", sw, pick), file);
  }

  function load(json: unknown, name: string): Bench {
    const r = bench(json, { name });
    kept = { name: name.slice(0, 80) || "Bench pedal", board: json, knobs: {} };
    result = r;
    save();
    draw();
    o.changed(r.ok);
    return r;
  }

  async function readFile(f: File) {
    const name = f.name.replace(/(\.circuit)?\.json$/i, "");
    let json: unknown;
    try { json = JSON.parse(await f.text()); } catch { json = null; }
    load(json, name);
  }

  floor.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  floor.addEventListener("dragleave", () => el.classList.remove("over"));
  floor.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) void readFile(f);
  });

  if (kept) result = bench(kept.board, { name: kept.name });
  draw();
  return {
    el,
    load,
    net: () => {
      if (!kept || !result?.ok) return null;
      const k = kept;
      return result.pedal.net(Object.fromEntries(result.pedal.knobs.map((p) => [p.name, (k.knobs[p.name] ?? 5) / 10])));
    },
    light: (on) => el.classList.toggle("lit", on),
    state: () => kept && result && {
      name: kept.name, ok: result.ok, why: result.ok ? [] : result.why, knobs: { ...kept.knobs }, gear: result.ok ? result.pedal.gear : null,
    },
  };
}
