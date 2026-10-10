import { useEffect, useRef, useState } from "react";
import { SEAT_NAMES } from "../../sim/rules.ts";
import { Controls, controlsFor, onControl, type Ctl } from "../input.ts";
import type { Driver, Frame } from "../driver.ts";
import { Renderer } from "../render/index.ts";
import { Sound } from "../audio.ts";
import { cuesFor, newCues } from "../cues.ts";
import { viewOf, type Settings } from "../settings.ts";
import { ControlHint } from "./Help.tsx";
import { Hud } from "./Hud.tsx";
import { OptionsDialog } from "./Options.tsx";
import { Podium } from "./Podium.tsx";

interface Props {
  driver: Driver;
  /** Controls per seat; empty = not a local player. */
  ctls: Ctl[][];
  settings: Settings;
  onSettings: (s: Settings) => void;
  onExit: () => void;
  /** Extra overlay (the network lobby). */
  lobby?: (frame: Frame) => React.ReactNode;
}

/** The control hint shows itself for this long after "CHOMP!". */
const HINT_MS = 6000;

export function Game({ driver, ctls, settings, onSettings, onExit, lobby }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [fluid, setFluid] = useState("");
  const [finale, setFinale] = useState(false);
  const [autoHint, setAutoHint] = useState(false);
  const [hint, setHint] = useState<boolean | null>(null);       // null = automatic
  const [options, setOptions] = useState(false);
  const sound = useRef(new Sound());
  const renderer = useRef<Renderer | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const ui = useRef({ phase: "", options: false }); ui.current.options = options;
  const ctlsOf = (seat: number, k: number) => (driver.kind === "net" && ctls[k]?.length ? ctls[k]! : controlsFor(ctls, seat));

  useEffect(() => {
    sound.current.setMix({ muted: settings.muted, music: settings.music, effects: settings.effects });
    renderer.current?.setView(viewOf(settings));
  }, [settings]);

  useEffect(() => {
    const cv = canvas.current!, snd = sound.current, s0 = settingsRef.current;
    const r = (renderer.current = new Renderer(cv, overlay.current!, { sfx: (n) => snd.sfx(n), view: viewOf(s0) }));
    const controls = new Controls();
    // on the podium, in the lobby or in a dialog, Space/Enter press the focused button instead of chomping
    controls.attach(window, { uiKeys: (e) => (ui.current.options || (ui.current.phase !== "playing" && ui.current.phase !== "countdown")) && onControl(e.target) });
    if (ctls.some((c) => c.includes("touch"))) controls.attachTouch(cv);
    const unlock = () => snd.unlock();
    const keys = (e: KeyboardEvent) => {
      if (e.code === "KeyH" && !e.repeat && !(e.target instanceof HTMLInputElement) && !ui.current.options) setHint((h) => !(h ?? false));
    };
    window.addEventListener("keydown", unlock); window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", keys);
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    snd.setMix({ muted: s0.muted, music: s0.music, effects: s0.effects });

    if (import.meta.env.DEV) {
      // dev hook: background tabs pause rAF, so tests and screenshots step the sim by hand
      (window as unknown as { __hippo: unknown }).__hippo = {
        driver, renderer: r, seek: (s: number) => r.seek(s), skip: () => r.skipFinale(),
        run: (ms: number) => { let f: Frame | undefined; for (let t = 0; t < ms; t += 33) { f = driver.advance(33); if (f.events.length) for (const e of f.events) r.draw({ ...f, events: [e] }, performance.now()); } if (f) r.draw({ ...f, events: [] }, performance.now()); return f ? { phase: f.phase, scores: f.cur.hippos.map((h) => h.score), drops: f.cur.drops.length } : null; },
      };
    }
    let raf = 0, last = performance.now(), lastUi = 0, lastPhase = "", playingAt = 0;
    const cues = newCues();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last; last = now;
      controls.beginFrame();
      // local play: controls by seat; net: by local player, since the room picks the seats
      driver.mine().forEach((seat, k) => {
        const c = controls.sample(ctlsOf(seat, k));
        driver.input(seat, c.move, c.gulp, c.bellow);
        if (c.gulp && driver.kind === "net") r.predictGulp(seat, now);
      });
      controls.endFrame();
      const f = driver.advance(dt);
      ui.current.phase = f.phase;
      for (const e of f.events) snd.event(e, f.mine);
      for (const cue of cuesFor(cues, f.phase, f.cur.countdown)) cue === "fanfare" ? snd.fanfare() : snd.beep(cue === "go");
      if (f.phase === "playing" && lastPhase !== "playing") playingAt = now;
      r.draw(f, now);
      if (now - lastUi > 100 || f.phase !== lastPhase) {
        lastUi = now; setFrame(f); setFluid(r.fluidEngine); setFinale(r.finale.playing && r.finale.clock < r.finale.duration);
        setAutoHint(f.phase === "countdown" || (f.phase === "playing" && now - playingAt < HINT_MS));
      }
      lastPhase = f.phase;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); controls.detach(); r.dispose(); renderer.current = null; snd.dispose();
      window.removeEventListener("keydown", unlock); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", keys); window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  const hostIsMe = frame ? frame.mine.includes(frame.hostSeat) || driver.kind === "local" : true;
  const showHint = frame && (frame.phase === "countdown" || frame.phase === "playing") && (hint ?? autoHint);
  const local = frame?.mine.map((seat, k) => ({ name: frame.seats[seat]?.name || SEAT_NAMES[seat]!, ctls: ctlsOf(seat, k) })) ?? [];
  return (
    <>
      <div className="stage"><canvas ref={canvas} role="img" aria-label="Four hippos round an oil geyser in a jungle basin" /></div>
      <div className="layer" ref={overlay} aria-hidden />
      {frame && (frame.phase === "countdown" || frame.phase === "playing") && <Hud frame={frame} />}
      {showHint && local.length > 0 && <div className="hint-dock"><ControlHint seats={local} onClose={() => setHint(false)} /></div>}
      {frame && frame.phase === "podium" && <Podium frame={frame} canAct={hostIsMe} finale={finale} onSkip={() => { renderer.current?.skipFinale(); setFinale(false); }} onRematch={() => driver.command({ t: "rematch" })} onExit={onExit} />}
      {frame && lobby?.(frame)}
      <nav className="corner" aria-label="Game">
        {driver.simEngine === "rust" && <span className="pill static" title="the game's rules and bots (?sim=ts for the TypeScript twin)">sim: Rust/wasm</span>}
        <span className="pill static" title="the oil geyser's fluid simulation">{fluid === "rust" ? "fluid: Rust/wasm" : "fluid: TypeScript"}</span>
        <button className="pill" aria-pressed={!!(hint ?? autoHint)} onClick={() => setHint(!(hint ?? autoHint))}>Controls <kbd>H</kbd></button>
        <button className="pill" onClick={() => setOptions(true)}>Options</button>
        <button className="pill" aria-pressed={settings.muted} onClick={() => onSettings({ ...settings, muted: !settings.muted })}>{settings.muted ? "Unmute" : "Mute"}</button>
        <button className="pill" onClick={onExit}>Menu</button>
      </nav>
      {options && <OptionsDialog settings={settings} onSettings={onSettings} onClose={() => setOptions(false)} />}
    </>
  );
}
