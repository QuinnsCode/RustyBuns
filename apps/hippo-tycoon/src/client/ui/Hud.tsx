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
  return <span className={"v" + (v < 0 ? " neg" : "")} aria-hidden>${v}M</span>;
}

export function Hud({ frame }: { frame: Frame }) {
  const { cur, seats, mine } = frame;
  const secs = Math.ceil(cur.left / TICK_HZ);
  const overflow = frame.phase === "playing" && cur.left <= OVERFLOW_TICKS;
  const cd = Math.ceil(cur.countdown / TICK_HZ);
  return (
    <>
      <div className="hud" role="region" aria-label="Net worth">
        {cur.hippos.map((h) => {
          const human = seats[h.seat]?.human, name = human ? seats[h.seat]!.name : SEAT_NAMES[h.seat], you = mine.includes(h.seat);
          return (
            <div key={h.seat} role="group" aria-label={`${name}${human ? "" : ", bot"}${you ? ", you" : ""}: $${h.score} million`} className={"score" + (you ? " mine" : "")} style={{ borderColor: you ? undefined : hex(LOOKS[h.seat]!.accent) + "99" }}>
              <div className="n" aria-hidden>{you && <span className="you">YOU · </span>}{name}{human ? "" : " (bot)"}</div>
              <Worth value={h.score} />
            </div>
          );
        })}
      </div>
      {frame.phase === "playing" && <div className={"clock" + (overflow ? " hot" : "")} role="timer" aria-label={`${secs} seconds left`}>{secs}</div>}
      {frame.phase === "countdown" && <div className="banner" key={cd} aria-live="assertive">{cd > 0 ? cd : "CHOMP!"}</div>}
      {overflow && cur.left > OVERFLOW_TICKS - TICK_HZ * 2 && <div className="banner red" role="alert">OVERFLOW!</div>}
    </>
  );
}
