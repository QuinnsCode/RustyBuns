import { Account } from "./Account.tsx";
import type { SceneSummary } from "../actions/scenes.ts";
import { STRUCTURAL } from "../game/round.ts";
import type { Records } from "../game/score.ts";
import { login } from "./eqosys.ts";
import { agentName, Bands, cardNo, Gauge, operation, rankFor, RANKS, Tick, Trim, Uplink } from "./lab.tsx";

const FETCH_HINT = "bun scripts/fetch-scenes.ts --next 5";

/** The gadget lab's front console: the mission list on the left, the agent card and the uplink on the right. */
export function Menu({ scenes, dir, error, records, onQuick, onRooms, onBrowse, onHowTo }: {
  scenes: SceneSummary[] | null; dir: string; error: string | null; records: Records;
  onQuick: () => void; onRooms: () => void; onBrowse: () => void; onHowTo: () => void;
}) {
  const playable = scenes?.filter((s) => s.hasSplats).length ?? 0;
  const hunts = Object.values(records).reduce((n, r) => n + r.hunts, 0);
  const best = Math.max(0, ...Object.values(records).map((r) => r.best));
  const who = login()?.name ?? "guest";
  const rank = rankFor(hunts), next = RANKS.find(([n]) => n > hunts);
  return (
    <div className="screen menu">
      <Bands />
      <div className="lab">
        <section className="console">
          <p className="kicker">Gadget lab 7 · Splat Rooms</p>
          <h1 className="title">Splat Hunt</h1>
          <p className="dim">The room is dark. Your splat gun lights whatever it hits. Find the item before the trail goes cold.</p>
          <nav className="menu-nav">
            <button className="big go" onClick={onQuick} disabled={!playable}>Quick hunt<small>a random site</small></button>
            <button className="big" onClick={onRooms} disabled={!scenes?.length}>Choose a room<small>mission select</small></button>
            <button className="big" onClick={onBrowse} disabled={!scenes?.length}>Room browser<small>surveillance</small></button>
            <button className="big" onClick={onHowTo}>How to play<small>field manual</small></button>
          </nav>
        </section>

        <aside className="agent">
          <Trim />
          <p className="kicker">Agent card</p>
          <div className="agent-row">
            <div>
              <p className="agent-name">Agent {agentName(who).toUpperCase()}</p>
              <p className="dim small">{rank}{next ? ` · ${next[0] - hunts} more for ${next[1]}` : ""}</p>
            </div>
            <Gauge value={next ? hunts / next[0] : 1} label={`${hunts} hunts toward the next rank`} />
          </div>
          <dl className="readout">
            <div><dt>Hunts won</dt><dd>{hunts}</dd></div>
            <div><dt>Best score</dt><dd>{best || "—"}</dd></div>
            <div><dt>Sites</dt><dd>{playable}</dd></div>
          </dl>
          <div className="secure"><span className="kicker">Secure line</span><Account /></div>
          <div className="agent-foot">
            <span className="serial">Card № {cardNo(who)} · clearance {rank === "Recruit" ? "grey" : "blue"}</span>
            <span className="barcode" aria-hidden />
          </div>
        </aside>
      </div>

      <footer className="uplink-line">
        <Uplink />
        {error ? <span className="warn">{error}</span>
          : !scenes ? <span className="dim small">Raising the uplink…</span>
          : <span className="dim small">{playable} site{playable === 1 ? "" : "s"} on file{scenes.length > playable ? ` (+${scenes.length - playable} unsurveyed)` : ""} · {dir}</span>}
        {scenes && playable < 3 && <span className="dim small">More rooms: <code>{FETCH_HINT}</code></span>}
      </footer>
    </div>
  );
}

/** The mission-select board: each room an operation with its serial, its intel and three objectives to tick. */
export function RoomSelect({ scenes, records, onPick, onBack }: {
  scenes: SceneSummary[]; records: Records; onPick: (id: string) => void; onBack: () => void;
}) {
  return (
    <div className="screen rooms-screen">
      <Bands />
      <header className="screen-head">
        <button className="back" onClick={onBack}>← Menu</button>
        <div>
          <p className="kicker">Choose a room</p>
          <h1>Mission select</h1>
        </div>
      </header>
      <ul className="room-grid">
        {scenes.map((s) => {
          const r = records[s.id];
          const goals: [string, boolean][] = [["Find the item", !!r], ["Three stars (750+)", (r?.best ?? 0) >= 750], ["Under 10 seconds", (r?.fastest ?? Infinity) < 10]];
          return (
            <li key={s.id}>
              <button className="room-card" onClick={() => onPick(s.id)} disabled={!s.hasSplats}>
                <span className="serial">№ {s.id}</span>
                <span className="room-id">{operation(s.id)}</span>
                <span className="dim small room-top">Intel: {s.top.map(([k]) => k).filter((k) => !STRUCTURAL.has(k)).slice(0, 4).join(", ")}</span>
                <span className="dim small">{s.kinds} kinds · {s.objects} objects</span>
                {s.hasSplats && <span className="goals">{goals.map(([g, on]) => <span key={g} className={on ? "goal on" : "goal"}><Tick on={on} />{g}</span>)}</span>}
                <span className="room-foot">
                  {!s.hasSplats ? <span className="warn">Unsurveyed: download the PLY</span>
                    : r ? <span>best <b>{r.best}</b> · {r.fastest.toFixed(1)}s · {r.hunts} won</span>
                    : <span className="dim">not played yet</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="dim small">More rooms: <code>{FETCH_HINT}</code> from <code>apps/splat-rooms</code>, then reopen the menu.</p>
    </div>
  );
}

export function HowTo({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen menu">
      <Bands />
      <div className="console howto">
        <button className="back" onClick={onBack}>← Menu</button>
        <p className="kicker">Field manual · eyes only</p>
        <h1>How to play</h1>
        <ol>
          <li>The room goes dark and you're told what to find.</li>
          <li><b>Drag</b> to look around (the cog sets look speed). <b>Space</b> fires one splat; <b>Shift+Space</b> sprays twenty. Every hit lights that patch of the room for good.</li>
          <li>Charge holds twelve and refills one every 1.5 s, so sprays cost you time.</li>
          <li>Spotted it? Press <b>P</b> for pick mode and click it. A wrong pick costs four charge.</li>
          <li><b>Esc</b> pauses.</li>
        </ol>
        <h2>Scoring</h2>
        <p className="dim readout-box">Start at 1000. Each second costs 4, each splat 8, each wrong pick 120. 750+ is three stars, 450+ is two. Your best per room is saved on this machine.</p>
      </div>
    </div>
  );
}
