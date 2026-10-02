import type { SceneSummary } from "../actions/scenes.ts";
import { STRUCTURAL } from "../game/round.ts";
import type { Records } from "../game/score.ts";

const FETCH_HINT = "bun scripts/fetch-scenes.ts --next 5";

export function Menu({ scenes, dir, error, records, onQuick, onRooms, onBrowse, onHowTo }: {
  scenes: SceneSummary[] | null; dir: string; error: string | null; records: Records;
  onQuick: () => void; onRooms: () => void; onBrowse: () => void; onHowTo: () => void;
}) {
  const playable = scenes?.filter((s) => s.hasSplats).length ?? 0;
  const hunts = Object.values(records).reduce((n, r) => n + r.hunts, 0);
  const best = Math.max(0, ...Object.values(records).map((r) => r.best));
  return (
    <div className="screen menu">
      <div className="menu-card">
        <p className="kicker">Splat Rooms</p>
        <h1 className="title">Splat Hunt</h1>
        <p className="dim">The room is dark. You have a splat gun and something to find.</p>
        <nav className="menu-nav">
          <button className="big go" onClick={onQuick} disabled={!playable}>Quick hunt</button>
          <button className="big" onClick={onRooms} disabled={!scenes?.length}>Choose a room</button>
          <button className="big" onClick={onBrowse} disabled={!scenes?.length}>Room browser</button>
          <button className="big" onClick={onHowTo}>How to play</button>
        </nav>
        {error && <p className="warn">{error}</p>}
        {!scenes && !error && <p className="dim small">Looking for scenes…</p>}
        {scenes && (
          <p className="dim small">
            {playable} playable room{playable === 1 ? "" : "s"}{scenes.length > playable ? ` (+${scenes.length - playable} labels only)` : ""} in {dir}
            {hunts > 0 && <> · {hunts} hunt{hunts === 1 ? "" : "s"} won · best {best}</>}
          </p>
        )}
        {scenes && playable < 3 && <p className="dim small">More rooms: <code>{FETCH_HINT}</code></p>}
      </div>
    </div>
  );
}

export function RoomSelect({ scenes, records, onPick, onBack }: {
  scenes: SceneSummary[]; records: Records; onPick: (id: string) => void; onBack: () => void;
}) {
  return (
    <div className="screen rooms-screen">
      <header className="screen-head">
        <button className="back" onClick={onBack}>← Menu</button>
        <h1>Choose a room</h1>
      </header>
      <ul className="room-grid">
        {scenes.map((s) => {
          const r = records[s.id];
          return (
            <li key={s.id}>
              <button className="room-card" onClick={() => onPick(s.id)} disabled={!s.hasSplats}>
                <span className="room-id">{s.id}</span>
                <span className="dim small">{s.kinds} kinds · {s.objects} objects</span>
                <span className="dim small room-top">{s.top.map(([k]) => k).filter((k) => !STRUCTURAL.has(k)).slice(0, 4).join(", ")}</span>
                <span className="room-foot">
                  {!s.hasSplats ? <span className="warn">labels only: download the PLY</span>
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
      <div className="menu-card howto">
        <button className="back" onClick={onBack}>← Menu</button>
        <h1>How to play</h1>
        <ol>
          <li>The room goes dark and you're told what to find.</li>
          <li><b>Drag</b> to look around. <b>Space</b> fires one splat; <b>Shift+Space</b> sprays twenty. Every hit lights that patch of the room for good.</li>
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
