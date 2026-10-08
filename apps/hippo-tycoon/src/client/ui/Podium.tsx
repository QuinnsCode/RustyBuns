import { useRef } from "react";
import { SEAT_NAMES } from "../../sim/rules.ts";
import type { Frame } from "../driver.ts";
import { Worth } from "./Hud.tsx";

export interface PodiumProps {
  frame: Frame; canAct: boolean;
  /** The finale is still playing: offer to skip it. */
  finale: boolean;
  onSkip: () => void; onRematch: () => void; onExit: () => void;
}

export function Podium({ frame, canAct, finale, onSkip, onRematch, onExit }: PodiumProps) {
  const rows = frame.cur.hippos.map((h) => ({ seat: h.seat, score: h.score })).sort((a, b) => b.score - a.score || a.seat - b.seat);
  const top = rows[0]!.score;
  const name = (seat: number) => (frame.seats[seat]?.human ? frame.seats[seat]!.name : SEAT_NAMES[seat]!);
  const winners = rows.filter((r) => r.score === top);
  const youWon = winners.some((w) => frame.mine.includes(w.seat));
  const rematch = useRef<HTMLButtonElement>(null), menu = useRef<HTMLButtonElement>(null);
  return (
    <div className="podium">
      <section className="card" aria-labelledby="podium-title">
        <h1 className="title" id="podium-title" style={{ fontSize: 26 }}>{winners.length > 1 ? "A SHARED FORTUNE" : youWon ? "YOU'RE THE TYCOON" : "RICHEST HIPPO"}</h1>
        <p className="tag" style={{ margin: "8px 0 6px" }}>Final net worth</p>
        <p className="sr-only" aria-live="polite">{winners.map((w) => name(w.seat)).join(" and ")} {winners.length > 1 ? "share" : "wins"} with ${top} million.</p>
        <ol>
          {rows.map((r) => (
            <li key={r.seat} className={r.score === top ? "win" : ""} aria-label={`${name(r.seat)}${frame.mine.includes(r.seat) ? " (you)" : ""}: $${r.score} million${r.score === top ? ", winner" : ""}`}>
              <span aria-hidden>{r.score === top ? "👑 " : ""}{name(r.seat)}</span>
              <span className="worth"><Worth value={r.score} /></span>
            </li>
          ))}
        </ol>
        <div className="row">
          {finale && <button className="btn" style={{ flex: 1 }} onClick={() => { onSkip(); (canAct ? rematch : menu).current?.focus(); }} autoFocus>Skip</button>}
          <button ref={rematch} className="btn go" style={{ flex: 1 }} disabled={!canAct} onClick={onRematch} autoFocus={!finale}>Rematch</button>
          <button ref={menu} className="btn" style={{ flex: 1 }} onClick={onExit}>Menu</button>
        </div>
        {!canAct && <p className="hint">Waiting for the host to start the next round.</p>}
      </section>
    </div>
  );
}
