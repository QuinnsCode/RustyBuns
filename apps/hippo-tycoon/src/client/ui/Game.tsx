import { useEffect, useRef, useState } from "react";
import { TICK_HZ } from "../../sim/rules.ts";
import { Controls, type Ctl } from "../input.ts";
import type { Driver, Frame } from "../driver.ts";
import { Renderer } from "../render/index.ts";
import { Sound } from "../audio.ts";
import { Hud } from "./Hud.tsx";
import { Podium } from "./Podium.tsx";

interface Props {
  driver: Driver;
  /** Controls per seat; empty = not a local player. */
  ctls: Ctl[][];
  muted: boolean;
  onMute: (m: boolean) => void;
  onExit: () => void;
  /** Extra overlay (the network lobby). */
  lobby?: (frame: Frame) => React.ReactNode;
  /** Net drivers pass the seat the server gave them; local ones use ctls. */
  seatsOf?: (frame: Frame) => number[];
}

export function Game({ driver, ctls, muted, onMute, onExit, lobby, seatsOf }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const sound = useRef(new Sound());
  const mutedRef = useRef(muted); mutedRef.current = muted;

  useEffect(() => {
    sound.current.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const cv = canvas.current!, snd = sound.current;
    const renderer = new Renderer(cv, overlay.current!);
    const controls = new Controls();
    controls.attach();
    if (ctls.some((c) => c.includes("touch"))) controls.attachTouch(cv);
    const unlock = () => snd.unlock();
    window.addEventListener("keydown", unlock); window.addEventListener("pointerdown", unlock);
    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);
    snd.setMuted(mutedRef.current);

    if (import.meta.env.DEV) {
      // dev hook: background tabs pause rAF, so tests and screenshots step the sim by hand
      (window as unknown as { __hippo: unknown }).__hippo = {
        driver,
        run: (ms: number) => { let f: Frame | undefined; for (let t = 0; t < ms; t += 33) { f = driver.advance(33); if (f.events.length) for (const e of f.events) renderer.draw({ ...f, events: [e] }, performance.now()); } if (f) renderer.draw({ ...f, events: [] }, performance.now()); return f ? { phase: f.phase, scores: f.cur.hippos.map((h) => h.score), drops: f.cur.drops.length } : null; },
      };
    }
    let raf = 0, last = performance.now(), lastUi = 0, lastPhase = "", lastCd = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last; last = now;
      controls.beginFrame();
      const peek = driver.advance(0);
      const seats = seatsOf ? seatsOf(peek) : peek.mine;
      for (const seat of seats) {
        const c = controls.sample(ctls[seat] ?? ctls[0] ?? ["kbAll", "touch"]);
        driver.input(seat, c.move, c.gulp, c.bellow);
        if (c.gulp && driver.kind === "net") renderer.predictGulp(seat, now);
      }
      controls.endFrame();
      const f = driver.advance(dt);
      for (const e of f.events) snd.event(e, f.mine);
      const cd = Math.ceil(f.cur.countdown / TICK_HZ);
      if (f.phase === "countdown" && cd !== lastCd) { lastCd = cd; snd.beep(cd === 0); }
      if (f.phase === "playing" && lastCd !== -2) { lastCd = -2; snd.beep(true); }
      if (f.phase === "podium" && lastPhase !== "podium") snd.fanfare();
      if (f.phase !== "podium" && f.phase !== "playing") lastCd = f.phase === "countdown" ? lastCd : -1;
      if (f.phase === "lobby" || f.phase === "countdown") { if (lastPhase === "podium") lastCd = -1; }
      lastPhase = f.phase;
      renderer.draw(f, now);
      if (now - lastUi > 100 || f.phase !== frame?.phase) { lastUi = now; setFrame(f); }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); controls.detach(); renderer.dispose();
      window.removeEventListener("keydown", unlock); window.removeEventListener("pointerdown", unlock); window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  const hostIsMe = frame ? frame.mine.includes(frame.hostSeat) || driver.kind === "local" : true;
  return (
    <>
      <div className="stage"><canvas ref={canvas} /></div>
      <div className="layer" ref={overlay} />
      {frame && (frame.phase === "countdown" || frame.phase === "playing") && <Hud frame={frame} />}
      {frame && frame.phase === "podium" && <Podium frame={frame} canAct={hostIsMe} onRematch={() => driver.command({ t: "rematch" })} onExit={onExit} />}
      {frame && lobby?.(frame)}
      <div className="corner">
        <span className="pill" onClick={() => onMute(!muted)}>{muted ? "Unmute" : "Mute"}</span>
        <span className="pill" onClick={onExit}>Menu</span>
      </div>
    </>
  );
}
