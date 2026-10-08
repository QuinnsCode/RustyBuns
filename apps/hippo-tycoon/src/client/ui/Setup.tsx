import { useEffect, useState } from "react";
import { SEAT_NAMES, SEATS } from "../../sim/rules.ts";
import { CTL_LABEL, type Ctl } from "../input.ts";

const OPTIONS: Ctl[] = ["bot", "kb1", "kb2", "pad0", "pad1", "pad2", "pad3"];

/** Couch seat picker: each seat takes a controller or a bot. */
export function Setup({ onStart, onBack }: { onStart: (ctls: Ctl[]) => void; onBack: () => void }) {
  const [seats, setSeats] = useState<Ctl[]>(["kb1", "kb2", "bot", "bot"]);
  const [pads, setPads] = useState<boolean[]>([false, false, false, false]);

  // a gamepad "joins" when it first shows up or any of its buttons is pressed
  useEffect(() => {
    const id = setInterval(() => {
      const gp = navigator.getGamepads?.() ?? [];
      setPads([0, 1, 2, 3].map((i) => !!gp[i]));
      gp.forEach((p, i) => {
        if (!p || i > 3 || !p.buttons.some((b) => b.pressed)) return;
        const id = `pad${i}` as Ctl;
        setSeats((s) => (s.includes(id) ? s : s.map((c, k) => (k === s.findIndex((x) => x === "bot") ? id : c))));
      });
    }, 120);
    return () => clearInterval(id);
  }, []);

  const cycle = (seat: number) => setSeats((s) => {
    const taken = new Set(s.filter((_, i) => i !== seat));
    const ok = OPTIONS.filter((o) => o === "bot" || (!taken.has(o) && (!o.startsWith("pad") || pads[Number(o.slice(3))])));
    const next = ok[(ok.indexOf(s[seat]!) + 1) % ok.length]!;
    return s.map((c, i) => (i === seat ? next : c));
  });

  const humans = seats.filter((c) => c !== "bot").length;
  return (
    <div className="menu">
      <div className="card">
        <h1 className="title" style={{ fontSize: 34 }}>COUCH</h1>
        <p className="tag">Pick who sits where. Bots take the empty offices.</p>
        <div className="seats">
          {Array.from({ length: SEATS }, (_, i) => (
            <div key={i} className={"seat" + (seats[i] !== "bot" ? " mine" : "")}>
              <b>{SEAT_NAMES[i]}</b>
              <span className="who">{seats[i] === "bot" ? "Bot" : `Player · ${CTL_LABEL[seats[i]!]}`}</span>
              <button className="btn" onClick={() => cycle(i)}>Change</button>
            </div>
          ))}
        </div>
        <div className="col" style={{ marginTop: 16 }}>
          <button className="btn go" disabled={humans === 0} onClick={() => onStart(seats)}>Start</button>
          <button className="btn" onClick={onBack}>Back</button>
        </div>
        <p className="hint">Press a button on a gamepad to join with it. Keyboard players share the keyboard: A/D + W + Q, and arrows + ↑ + /.</p>
      </div>
    </div>
  );
}
