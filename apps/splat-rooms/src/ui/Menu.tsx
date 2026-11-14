import { Account } from "./Account.tsx";
import type { SceneSummary } from "../actions/scenes.ts";
import { STRUCTURAL } from "../game/round.ts";
import type { Records } from "../game/score.ts";
import { Band, codename, Crest, Gadget, operation, rank, RotaryDial, serial, Uplink } from "./lab.tsx";

const FETCH_HINT = "bun scripts/fetch-scenes.ts --next 5";

export function Menu({ scenes, dir, error, records, onQuick, onRooms, onBrowse, onHowTo }: {
  scenes: SceneSummary[] | null; dir: string; error: string | null; records: Records;
  onQuick: () => void; onRooms: () => void; onBrowse: () => void; onHowTo: () => void;
}) {
  const playable = scenes?.filter((s) => s.hasSplats).length ?? 0;
  const hunts = Object.values(records).reduce((n, r) => n + r.hunts, 0);
  const best = Math.max(0, ...Object.values(records).map((r) => r.best));
  const agent = codename(dir || "guest");
  return (
    <div className="screen menu lab">
      <div className="menu-card console">
        <Band label="SR-LAB · MISSION SELECT" />
        <header className="lab-head">
          <Crest size={72} />
          <div>
            <p className="kicker">Splat Rooms · Gadget Lab</p>
            <h1 className="title">Splat Hunt</h1>
          </div>
        </header>
        <p className="dim">The room is dark. You have a splat gun and something to find.</p>
        <div className="agent" aria-label="Your agent card">
          <span className="agent-k">Agent</span><b>{agent}</b>
          <span className="agent-k">Rank</span><b>{rank(hunts)}</b>
          <span className="agent-k">Record</span><b>{hunts} won · best {best}</b>
        </div>
        <nav className="menu-nav">
          <button className="big go" onClick={onQuick} disabled={!playable}>Quick hunt<small>Random room, no briefing</small></button>
          <button className="big" onClick={onRooms} disabled={!scenes?.length}>Choose a room<small>The mission board</small></button>
          <button className="big" onClick={onBrowse} disabled={!scenes?.length}>Room browser<small>Survey a site</small></button>
          <button className="big" onClick={onHowTo}>How to play<small>The field manual</small></button>
        </nav>
        <div className="secure-line"><RotaryDial /><div><span className="agent-k">Secure line · eqosys</span><Account /></div></div>
        {error && <p className="warn">{error}</p>}
        {!scenes && !error && <Uplink text="Uplink · searching for scenes…" />}
        {scenes && <Uplink text={`${serial(dir)} · Uplink secure · ${playable} room${playable === 1 ? "" : "s"} on file${scenes.length > playable ? ` (+${scenes.length - playable} labels only)` : ""}`} />}
        {scenes && <p className="dim small path">{dir}</p>}
        {scenes && playable < 3 && <p className="dim small">More rooms: <code>{FETCH_HINT}</code></p>}
      </div>
    </div>
  );
}

export function RoomSelect({ scenes, records, onPick, onBack }: {
  scenes: SceneSummary[]; records: Records; onPick: (id: string) => void; onBack: () => void;
}) {
  return (
    <div className="screen rooms-screen lab">
      <header className="screen-head">
        <button className="back" onClick={onBack}>← Menu</button>
        <h1>Mission board</h1>
        <span className="dim small">Choose a room</span>
      </header>
      <div className="board-band"><Band label={`MISSION BOARD · ${scenes.length} SITES ON FILE`} /></div>
      <ul className="room-grid">
        {scenes.map((s) => {
          const r = records[s.id];
          const goals: [string, boolean][] = [["Find the target", !!r], ["Three stars (750+)", (r?.best ?? 0) >= 750], ["Under 20 seconds", !!r && r.fastest < 20]];
          return (
            <li key={s.id}>
              <button className="room-card" onClick={() => onPick(s.id)} disabled={!s.hasSplats}>
                <span className="room-serial">{serial(s.id)} · {s.id}</span>
                <span className="room-id">{operation(s.id)}</span>
                <span className="dim small">{s.kinds} kinds · {s.objects} objects</span>
                <span className="dim small room-top">{s.top.map(([k]) => k).filter((k) => !STRUCTURAL.has(k)).slice(0, 4).join(", ")}</span>
                {s.hasSplats ? (
                  <ul className="goals">{goals.map(([g, done]) => <li key={g} className={done ? "done" : ""}><Tick done={done} />{g}</li>)}</ul>
                ) : <span className="room-foot warn">Labels only: download the PLY</span>}
                {r && <span className="room-foot">best <b>{r.best}</b> · {r.fastest.toFixed(1)}s · {r.hunts} won</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="dim small">More rooms: <code>{FETCH_HINT}</code> from <code>apps/splat-rooms</code>, then reopen the menu.</p>
    </div>
  );
}

/** An objective's indicator lamp on the console: a dark lens in a steel bezel, lit once it is done. */
const Tick = ({ done }: { done: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 13 13" role="img" aria-label={done ? "done" : "to do"}><circle cx="6.5" cy="6.5" r="6" className="lamp-bezel" /><circle cx="6.5" cy="6.5" r="3.6" className="lamp-glass" /></svg>
);

/** The briefcase's foam: each gadget, what it is called in the lab, and the key that works it. */
const KIT = [["spray", "Splat projector", "Space"], ["cell", "Charge cell", "12 shots"], ["lens", "Pick lens", "P"], ["watch", "Field watch", "Esc"]] as const;

export function HowTo({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen menu lab">
      <div className="menu-card console howto briefcase">
        <div className="case-lid" aria-hidden><i className="latch" /><span>Field kit · {serial("field-kit")}</span><i className="latch" /></div>
        <Band label="FIELD MANUAL · EYES ONLY" />
        <button className="back" onClick={onBack}>← Menu</button>
        <h1>How to play</h1>
        <ul className="foam" aria-label="The kit">
          {KIT.map(([kind, name, key]) => <li key={kind}><Gadget kind={kind} /><b>{name}</b><span>{key}</span></li>)}
        </ul>
        <ol>
          <li>The room goes dark and you're told what to find.</li>
          <li><b>Drag</b> to look around (the cog sets look speed). <b>Space</b> fires one splat; <b>Shift+Space</b> sprays twenty. Every hit lights that patch of the room for good.</li>
          <li>Charge holds twelve and refills one every 1.5 s, so sprays cost you time.</li>
          <li>Spotted it? Press <b>P</b> for pick mode and click it. A wrong pick costs four charge.</li>
          <li><b>Esc</b> pauses.</li>
        </ol>
        <h2>Scoring</h2>
        <p className="dim">Start at 1000. Each second costs 4, each splat 8, each wrong pick 120. 750+ is three stars, 450+ is two. Your best per room is saved on this machine.</p>
      </div>
    </div>
  );
}
