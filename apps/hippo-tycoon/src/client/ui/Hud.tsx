import { useEffect, useRef, useState } from "react";
import { OVERFLOW_TICKS, SEAT_NAMES, TICK_HZ } from "../../sim/rules.ts";
import type { Frame } from "../driver.ts";
import { LOOKS } from "../render/looks.ts";

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

/** Net worth in $ millions, rolling up toward the real number. */
export function Worth({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const target = useRef(value); target.current = value;
  useEffect(() => {
    const id = setInterval(() => setShown((s) => (Math.abs(s - target.current) < 0.5 ? target.current : s + (target.current - s) * 0.35)), 50);
    return () => clearInterval(id);
  }, []);
  const v = Math.round(shown);
  return <span className={"v" + (v < 0 ? " neg" : "")}>${v}M</span>;
}

export function Hud({ frame }: { frame: Frame }) {
  const { cur, seats, mine } = frame;
  const secs = Math.ceil(cur.left / TICK_HZ);
  const overflow = frame.phase === "playing" && cur.left <= OVERFLOW_TICKS;
  const cd = Math.ceil(cur.countdown / TICK_HZ);
  return (
    <>
      <div className="hud">
        {cur.hippos.map((h) => (
          <div key={h.seat} className={"score" + (mine.includes(h.seat) ? " mine" : "")} style={{ borderColor: mine.includes(h.seat) ? undefined : hex(LOOKS[h.seat]!.accent) + "99" }}>
            <div className="n">{seats[h.seat]?.human ? seats[h.seat]!.name : SEAT_NAMES[h.seat]}{seats[h.seat]?.human ? "" : " (bot)"}</div>
            <Worth value={h.score} />
          </div>
        ))}
      </div>
      {frame.phase === "playing" && <div className={"clock" + (overflow ? " hot" : "")}>{secs}</div>}
      {frame.phase === "countdown" && <div className="banner" key={cd}>{cd > 0 ? cd : "CHOMP!"}</div>}
      {overflow && cur.left > OVERFLOW_TICKS - TICK_HZ * 2 && <div className="banner red">OVERFLOW!</div>}
    </>
  );
}
