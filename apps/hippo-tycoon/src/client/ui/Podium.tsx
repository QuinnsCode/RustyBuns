import { SEAT_NAMES } from "../../sim/rules.ts";
import type { Frame } from "../driver.ts";
import { Worth } from "./Hud.tsx";

export function Podium({ frame, canAct, onRematch, onExit }: { frame: Frame; canAct: boolean; onRematch: () => void; onExit: () => void }) {
  const rows = frame.cur.hippos.map((h) => ({ seat: h.seat, score: h.score })).sort((a, b) => b.score - a.score || a.seat - b.seat);
  const top = rows[0]!.score;
  return (
    <div className="podium">
      <div className="card">
        <h1 className="title" style={{ fontSize: 26 }}>{rows.filter((r) => r.score === top).length > 1 ? "A SHARED FORTUNE" : "RICHEST HIPPO"}</h1>
        <p className="tag" style={{ margin: "8px 0 6px" }}>Final net worth</p>
        <ol>
          {rows.map((r) => (
            <li key={r.seat} className={r.score === top ? "win" : ""}>
              <span>{r.score === top ? "👑 " : ""}{frame.seats[r.seat]?.human ? frame.seats[r.seat]!.name : SEAT_NAMES[r.seat]}</span>
              <span className="worth"><Worth value={r.score} /></span>
            </li>
          ))}
        </ol>
        <div className="row">
          <button className="btn go" style={{ flex: 1 }} disabled={!canAct} onClick={onRematch}>Rematch</button>
          <button className="btn" style={{ flex: 1 }} onClick={onExit}>Menu</button>
        </div>
        {!canAct && <p className="hint">Waiting for the host to start the next round.</p>}
      </div>
    </div>
  );
}
