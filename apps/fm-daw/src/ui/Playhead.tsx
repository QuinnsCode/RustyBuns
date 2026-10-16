import { useTick } from "./store.ts";

/** A line across the grid at the loop position. Lives in its own component so ticks only redraw this. */
export function Playhead({ loopBeats, from = 0 }: { loopBeats: number; from?: number }) {
  const pos = useTick((t) => (t.playing ? t.pos - from : -1));
  if (pos < 0 || pos >= loopBeats) return null;
  return <div className="playhead" style={{ left: `${(pos / loopBeats) * 100}%` }} aria-hidden />;
}
