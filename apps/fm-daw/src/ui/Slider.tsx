// A labelled fader. `log` maps the travel exponentially (times, ratios), so the
// short end isn't crammed into the first few pixels.
import { RANGES } from "../engine/params.ts";

const STEPS = 1000;

export function Slider(props: {
  label: string; index: number; value: number; log?: boolean; unit?: string;
  format?: (v: number) => string;
  onChange(v: number): void;
}) {
  const [lo, hi] = RANGES[props.index];
  const toPos = (v: number) => props.log ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
  const fromPos = (x: number) => props.log ? lo * Math.pow(hi / lo, x) : lo + x * (hi - lo);
  const fmt = props.format ?? defaultFormat(props.unit);
  return (
    <label className="fader">
      <span className="silk">{props.label}</span>
      <input
        type="range" min={0} max={STEPS} step={1}
        value={Math.round(toPos(props.value) * STEPS)}
        onChange={(e) => props.onChange(fromPos(Number(e.currentTarget.value) / STEPS))}
        onDoubleClick={(e) => e.preventDefault()}
      />
      <output>{fmt(props.value)}</output>
    </label>
  );
}

function defaultFormat(unit?: string) {
  if (unit === "s") return (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
  if (unit === "st") return (v: number) => `${v.toFixed(1)} st`;
  if (unit === "x") return (v: number) => `×${v < 10 ? v.toFixed(2) : v.toFixed(1)}`;
  if (unit === "pan") return (v: number) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
  return (v: number) => `${Math.round(v * 100)}%`;
}
