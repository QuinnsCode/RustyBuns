// Wind back, in the status bar: pick how far and hear the groove as it was, alone. The leader can
// bring everyone back to it; that's one edit, so undo takes it back (src/rewind.ts).
import { RUNGS, rungName, type Rung } from "../rewind.ts";
import type { Project } from "../project.ts";

/** What the World sent back for this page's look: the groove as of `at` (ms), or none that far back. */
export type Rewound = { ago: Rung; at: number; project: Project | null };

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function WindBack(props: { rewound: Rewound | null; leads: boolean; onAsk(ago: Rung): void; onBack(): void; onBring(): void }) {
  const r = props.rewound;
  return (
    <>
      <select value={r?.ago ?? ""} aria-label="Wind back" title="Hear the groove as it was, alone"
        onChange={(e) => { const ago = RUNGS.find((x) => x === Number(e.currentTarget.value)); if (ago) props.onAsk(ago); }}>
        <option value="" disabled>Wind back…</option>
        {RUNGS.map((x) => <option key={x} value={x}>{rungName(x)} back</option>)}
      </select>
      {r && !r.project && <span className="dim" role="status">The sesh doesn't go back {rungName(r.ago)} yet</span>}
      {r?.project && <>
        <span className="warn-text" role="status">Hearing it as of {clock(r.at)}, only here</span>
        {props.leads && <button className="ghost" onClick={props.onBring} title="Everyone gets this groove (undo takes it back)">Bring everyone back here</button>}
        <button className="ghost" onClick={props.onBack} title="Back to the sesh as it is now">Back to now</button>
      </>}
    </>
  );
}
