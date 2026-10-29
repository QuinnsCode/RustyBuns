// Everyone else's pointer in the sesh, each with its own color, so you can see who's
// about to turn which knob. They arrive on the live line; yours is never drawn.
import { useSyncExternalStore } from "react";

type Cursor = { x: number; y: number; at: number };
let cursors = new Map<number, Cursor>();
const subs = new Set<() => void>();
const changed = () => { cursors = new Map(cursors); for (const s of subs) s(); };

/** A pointer that hasn't moved in this long fades out. */
const STILL_MS = 8000;

export function moveCursor(from: number, x: number, y: number) { cursors.set(from, { x, y, at: Date.now() }); changed(); }
export function dropCursor(from: number) { if (cursors.delete(from)) changed(); }
export function dropAllCursors() { if (cursors.size) { cursors.clear(); changed(); } }
export const peerColor = (from: number) => `hsl(${(from * 137) % 360} 85% 60%)`;

export function Cursors() {
  const all = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cursors);
  const now = Date.now();
  return (
    <div className="cursors" aria-hidden>
      {[...all].map(([from, c]) => (
        <div key={from} className="cursor" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, color: peerColor(from), opacity: now - c.at > STILL_MS ? 0.25 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 2 L16 8 L9 10 L6 16 Z" fill="currentColor" stroke="var(--bg)" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </div>
      ))}
    </div>
  );
}
