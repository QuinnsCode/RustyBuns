// The Mixer tab: the sesh's desk (src/mixer.ts `seshDesk`): a strip per track, one per player the live line plays
// sound for, the Space return and the aux 2 return (what the sesh's gear room has cabled into it). A track's strip is
// its track, so each move goes out as the same edits the rest of FM DAW sends (`deskOps`); a player's strip and the
// aux 2 return are the project's `desk`. Everyone hears one mix.
// The strips are the gear room's (src/room/desk.ts), drawn again whenever the project changes.
import { useEffect, useRef } from "react";
import { deskOps, seshDesk, type Player } from "../mixer.ts";
import type { Op, Project } from "../project.ts";
import { drawDesk } from "../room/desk.ts";

export function DeskPanel({ project, players, cabled, onOps }: { project: Project; players: readonly Player[]; cabled: string; onOps: (ops: Op[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ project, onOps });
  latest.current = { project, onOps };
  const who = JSON.stringify(players);
  useEffect(() => {
    if (!host.current) return;
    drawDesk(host.current, seshDesk(project, players), ["", cabled], (d) => { const { project: p, onOps: send } = latest.current; send(deskOps(p, d)); }, { spaceMute: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, who, cabled]);
  return (
    <section className="desk-panel" aria-label="Mixer">
      <span className="silk">Mixer</span>
      <div className="desk-strips" ref={host} />
    </section>
  );
}
