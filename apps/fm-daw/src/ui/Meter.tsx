// Output meter in dBFS with a hold line, plus the limiter lamp. The limiter
// ceiling is -1 dBFS, so the bar can't go past that mark.
import { useRef } from "react";
import { useTick } from "./store.ts";

const FLOOR = -48;
const toDb = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x));
const frac = (db: number) => Math.min(Math.max((db - FLOOR) / -FLOOR, 0), 1);

export function Meter() {
  const peakL = useTick((t) => t.peakL), peakR = useTick((t) => t.peakR);
  const minGain = useTick((t) => t.minGain), nans = useTick((t) => t.nans);
  const hold = useRef({ db: -Infinity, at: 0 });
  const lamp = useRef(0);
  const db = toDb(Math.max(peakL, peakR));
  const now = performance.now();
  if (db > hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  if (minGain < 0.97) lamp.current = now;
  const limiting = now - lamp.current < 400;
  return (
    <div className="meter" title="Output level. The limiter holds everything under -1 dBFS.">
      <div className="bars">
        {[peakL, peakR].map((p, i) => (
          <div key={i} className="bar"><div className="fill" style={{ width: `${frac(toDb(p)) * 100}%` }} /></div>
        ))}
        <div className="hold" style={{ left: `${frac(hold.current.db) * 100}%` }} />
        <div className="ceil" style={{ left: `${frac(-1) * 100}%` }} />
      </div>
      <span className="readout">{Number.isFinite(hold.current.db) ? hold.current.db.toFixed(1) : "−∞"}</span>
      <span className={limiting ? "lamp lit" : "lamp"}>Limit</span>
      {nans > 0 && <span className="lamp warn" title="A voice produced NaN and the engine reset itself">Reset ×{nans}</span>}
    </div>
  );
}
