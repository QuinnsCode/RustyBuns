// The Mixer tab: the sesh's desk (src/mixer.ts `seshDesk`): a strip per track, one per player the live line plays
// sound for, the Space return, the aux 2 return (what the sesh's gear room has cabled into it) and the master. A track's
// strip is its track, so each move goes out as the same edits the rest of FM DAW sends (`deskOps`); a player's strip
// and the returns are the project's `desk`. Everyone hears one mix.
// The strips are the gear room's (src/room/desk.ts), drawn again whenever the project changes. A strip's Shape button
// opens the full Shape editor here, over the strips, on that channel.
import { useEffect, useRef, useState } from "react";
import { deskOps, seshDesk, seshShape, shapeName, shapeOps, type Player, type ShapeAt } from "../mixer.ts";
import type { Op, Project } from "../project.ts";
import { drawDesk } from "../room/desk.ts";
import { Shape } from "./Shape.tsx";

const atKey = (at: ShapeAt) => ("master" in at ? "master" : "aux" in at ? `aux:${at.aux}` : at.channel);

export function DeskPanel({ project, players, cabled, onOps, sampleRate, analyser }: {
  project: Project; players: readonly Player[]; cabled: string; onOps: (ops: Op[], group?: string) => void;
  sampleRate: number;
  /** The master's sound, for the master's spectrum. */
  analyser: AnalyserNode | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<ShapeAt | null>(null);
  const latest = useRef({ project, onOps });
  latest.current = { project, onOps };
  const who = JSON.stringify(players);
  useEffect(() => {
    if (!host.current) return;
    drawDesk(host.current, seshDesk(project, players), ["", cabled], (d) => { const { project: p, onOps: send } = latest.current; send(deskOps(p, d)); },
      { spaceMute: false, master: project.eq, shape: (next) => setAt((was) => (was && atKey(was) === atKey(next) ? null : next)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, who, cabled]);
  const desk = seshDesk(project, players);
  // a strip that left (a player went, a track count changed) closes its editor
  const shown = at && ("master" in at || ("aux" in at ? desk.returns.some((r) => r.aux === at.aux) : desk.channels.some((c) => c.id === at.channel))) ? at : null;
  const name = shown ? shapeName(desk, shown) : "";
  const master = shown !== null && "master" in shown;
  return (
    <section className="desk-panel" aria-label="Mixer">
      <span className="silk">Mixer</span>
      {shown && (
        <Shape key={atKey(shown)} doc={seshShape(project, players, shown)} sampleRate={sampleRate} analyser={master ? analyser : null}
          onChange={(bands, group) => onOps(shapeOps(latest.current.project, players, shown, bands), group)}
          head={
            <span className="desk-shape-head">
              <span className="silk">Shape · {name}</span>
              {!master && <span className="dim" title="Only the master's sound reaches the page on its own; a channel's spectrum isn't drawn">curve only</span>}
              <button type="button" className="ghost" onClick={() => setAt(null)} title="Close Shape" aria-label="Close Shape">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </span>
          } />
      )}
      <div className="desk-strips" ref={host} />
    </section>
  );
}
