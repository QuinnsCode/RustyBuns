// The on-screen help: how each local player moves, and what the five drops are.
// Every drop has a shape (in the pan and here) and a name, not only a colour.
import { GOLD, NAIL, OIL, SLUDGE, WATER } from "../../sim/rules.ts";
import type { Ctl } from "../input.ts";

export const DROP_CUES = [
  { kind: OIL, name: "Oil", shape: "round drop", effect: "+$1M" },
  { kind: GOLD, name: "Gold", shape: "faceted gem", effect: "+$3M" },
  { kind: SLUDGE, name: "Sludge", shape: "lumpy clod", effect: "−$1M, you choke" },
  { kind: NAIL, name: "Bolt", shape: "spiky bolt", effect: "−$2M, sore jaw" },
  { kind: WATER, name: "Water", shape: "teardrop", effect: "next chomp is a dud" },
] as const;

/** A little picture of each drop's silhouette. */
export function DropIcon({ kind }: { kind: number }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", "aria-hidden": true } as const;
  switch (kind) {
    case GOLD: return <svg {...common}><path d="M10 1 19 10 10 19 1 10Z" fill="#ffcb47" stroke="#fff6d0" strokeWidth="1" /><path d="M1 10h18M10 1v18" stroke="#b07a00" strokeWidth="0.8" /></svg>;
    case SLUDGE: return <svg {...common}><path d="M4 13c-3-1-2-6 1-6 0-3 4-4 6-2 2-2 6-1 6 2 3 1 2 6-1 7-1 3-5 3-6 1-2 2-6 1-6-2Z" fill="#7a5530" stroke="#e8c9a0" strokeWidth="1" /></svg>;
    case NAIL: return <svg {...common}><path d="M10 0 12 7 19 5 13 10 19 15 12 13 10 20 8 13 1 15 7 10 1 5 8 7Z" fill="#b5bcc4" stroke="#fff" strokeWidth="0.8" /></svg>;
    case WATER: return <svg {...common}><path d="M10 1C10 1 3 10 3 13a7 7 0 0 0 14 0C17 10 10 1 10 1Z" fill="#55b6ff" stroke="#dff1ff" strokeWidth="1" /></svg>;
    default: return <svg {...common}><circle cx="10" cy="10" r="7.5" fill="#222" stroke="#e8e8e8" strokeWidth="1.5" /><circle cx="7.5" cy="7.5" r="2" fill="#fff" opacity="0.7" /></svg>;
  }
}

export function DropLegend() {
  return (
    <ul className="legend" aria-label="What the drops are">
      {DROP_CUES.map((d) => <li key={d.kind}><DropIcon kind={d.kind} /><b>{d.name}</b><span>{d.shape} · {d.effect}</span></li>)}
    </ul>
  );
}

const K = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;
type Line = [React.ReactNode, string];
function lines(c: Ctl): Line[] {
  switch (c) {
    case "kb1": return [[<><K>A</K> <K>D</K></>, "slide"], [<><K>W</K> or <K>Space</K></>, "chomp"], [<K>Q</K>, "bellow"]];
    case "kb2": return [[<><K>←</K> <K>→</K></>, "slide"], [<><K>↑</K> or <K>Enter</K></>, "chomp"], [<K>/</K>, "bellow"]];
    case "kbAll": return [[<><K>A</K> <K>D</K> or <K>←</K> <K>→</K></>, "slide"], [<><K>W</K> <K>Space</K> <K>↑</K> or <K>Enter</K></>, "chomp"], [<><K>Q</K> or <K>/</K></>, "bellow"]];
    case "touch": return [["Drag", "slide"], ["Tap", "chomp"]];
    case "bot": return [];
    default: return [["Stick or d-pad", "slide"], [<K>A</K>, "chomp"], [<K>B</K>, "bellow"]];
  }
}

/** Who moves how, for each seat played on this machine, and the drop legend. */
export function ControlHint({ seats, onClose }: { seats: { name: string; ctls: readonly Ctl[] }[]; onClose?: () => void }) {
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return (
    <section className="help card" aria-label="Controls">
      <div className="help-cols">
        {seats.map((s) => (
          <dl key={s.name}>
            {seats.length > 1 && <dt className="who">{s.name}</dt>}
            {s.ctls.filter((c) => c !== "touch" || touch).flatMap(lines).map(([keys, what], i) => <dd key={i}><span className="keys">{keys}</span><span>{what}</span></dd>)}
          </dl>
        ))}
        <DropLegend />
      </div>
      <p className="hint" style={{ margin: "8px 0 0" }}><K>H</K> shows or hides this{onClose && <> · <button className="link" onClick={onClose}>hide</button></>}</p>
    </section>
  );
}
