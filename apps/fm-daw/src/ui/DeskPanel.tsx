// The Mixer tab: the sesh's desk (src/mixer.ts `seshDesk`), a strip per track and the Space return. A strip is its
// track, so each move goes out as the same edits the rest of FM DAW sends (`deskOps`) and everyone hears one mix.
// The strips are the gear room's (src/room/desk.ts), drawn again whenever the project changes.
import { useEffect, useRef } from "react";
import { deskOps, seshDesk } from "../mixer.ts";
import type { Op, Project } from "../project.ts";
import { drawDesk } from "../room/desk.ts";

export function DeskPanel({ project, onOps }: { project: Project; onOps: (ops: Op[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ project, onOps });
  latest.current = { project, onOps };
  useEffect(() => {
    if (!host.current) return;
    drawDesk(host.current, seshDesk(project), [], (d) => { const { project: p, onOps: send } = latest.current; send(deskOps(p, d)); }, { returnMute: false });
  }, [project]);
  return (
    <section className="desk-panel" aria-label="Mixer">
      <span className="silk">Mixer</span>
      <div className="desk-strips" ref={host} />
    </section>
  );
}
