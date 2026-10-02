import { useEffect, useRef, useState } from "react";
import { readScene, type SceneDetail } from "../actions/scenes.ts";
import { planRound, type Candidate, type Round } from "../game/round.ts";
import { record, stars, type Records } from "../game/score.ts";
import { GameView } from "../game/view.ts";

const CAPACITY = 12;
const REGEN_MS = 1500;      // one charge every 1.5 s
const SPRAY_COST = 6;
const WRONG_COST = 4;

type Phase = "loading" | "hunting" | "paused" | "found" | "failed";
interface Result { points: number; newBest: boolean; seconds: number; splats: number; wrong: number }

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export function Game({ sceneId, records, onRecords, onAnotherRoom, onRooms, onQuit }: {
  sceneId: string;
  records: Records;
  onRecords: (r: Records) => void;
  onAnotherRoom: () => void;
  onRooms: () => void;
  onQuit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef<GameView | null>(null);
  const sceneRef = useRef<SceneDetail | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<string | null>(null);
  const [charge, setCharge] = useState(CAPACITY);
  const [shots, setShots] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // The view is built once, so its callbacks must not close over state: they
  // would see the values from the first render forever.
  const judgeRef = useRef<(c: Candidate | null) => void>(() => {});

  useEffect(() => {
    if (!canvasRef.current || !maskRef.current) return;
    const v = new GameView(canvasRef.current, maskRef.current, {
      onProgress: setStatus,
      onPick: (c) => judgeRef.current(c),
    });
    view.current = v;
    const fit = () => { const r = wrapRef.current?.getBoundingClientRect(); if (r) v.resize(r.width, r.height); };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    start();
    return () => { ro.disconnect(); v.destroy(); view.current = null; };
  }, []);

  // Charge regenerates: spraying is free to do and expensive to recover from.
  useEffect(() => {
    if (phase !== "hunting") return;
    const t = setInterval(() => setCharge((c) => Math.min(CAPACITY, c + 1)), REGEN_MS);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "hunting") return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => { view.current?.setPickMode(pickMode); }, [pickMode]);

  async function start() {
    setPhase("loading");
    setStatus("Setting up a round…");
    setMessage(null); setResult(null);
    try {
      const d = sceneRef.current ?? await readScene(sceneId);
      sceneRef.current = d;
      const r = planRound(d, { seed: newSeed() });
      if (!r) { setPhase("failed"); setStatus("No suitable target in this room. Try another."); return; }
      setRound(r);
      await view.current?.startRound(r, d.plyUrl);
      setCharge(CAPACITY); setShots(0); setWrong(0); setPickMode(false);
      setStartedAt(Date.now()); setElapsed(0);
      setPhase("hunting");
      setStatus(null);
    } catch (e) { setPhase("failed"); setStatus(`Failed: ${(e as Error).message}`); }
  }

  function pause() {
    if (phase !== "hunting") return;
    setElapsed((Date.now() - startedAt) / 1000);
    setPhase("paused");
  }
  function resume() {
    if (phase !== "paused") return;
    // Shift the start so the clock skips the time spent paused.
    setStartedAt(Date.now() - elapsed * 1000);
    setPhase("hunting");
  }

  useEffect(() => { judgeRef.current = judge; });

  function judge(c: Candidate | null) {
    if (!round || phase !== "hunting") return;
    if (!c) { setMessage("Nothing there."); return; }
    if (c.ins_id === round.target.ins_id) {
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);
      setPhase("found");
      setPickMode(false);
      view.current?.revealAll(true);
      view.current?.setHighlight(round.target);
      setMessage(null);
      const run = { seconds, splats: shots, wrong };
      const r = record(records, sceneId, run);
      onRecords(r.records);
      setResult({ ...run, points: r.points, newBest: r.newBest });
    } else {
      setWrong((w) => w + 1);
      setCharge((ch) => Math.max(0, ch - WRONG_COST));
      setMessage(`That's a ${c.label}, not the ${round.target.label}. -${WRONG_COST} charge.`);
    }
  }

  function fire(kind: "shot" | "spray") {
    if (phase !== "hunting" || !view.current) return;
    const cost = kind === "spray" ? SPRAY_COST : 1;
    if (charge < cost) { setMessage("Not enough charge."); return; }
    const res = kind === "spray" ? view.current.spray() : view.current.shoot();
    setCharge((c) => c - cost);
    setShots((s) => s + (kind === "spray" ? 20 : 1));
    if (!res.hit) setMessage("Into the void: nothing that way.");
    else setMessage(null);
  }

  // Keyboard: space shoots, shift-space sprays, P toggles pick mode, Esc pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") { phase === "paused" ? resume() : pause(); return; }
      if (phase === "found" && (e.code === "Space" || e.key === "Enter")) { e.preventDefault(); start(); return; }
      if (phase !== "hunting") return;
      if (e.code === "Space") { e.preventDefault(); fire(e.shiftKey ? "spray" : "shot"); }
      if (e.key.toLowerCase() === "p") setPickMode((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const targetName = round?.target.label ?? "";
  const best = records[sceneId];
  const playing = phase === "hunting" || phase === "paused";
  return (
    <div className="game">
      <div className="game-stage" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <canvas ref={maskRef} className="mask" />
        <div className="cross" aria-hidden><span /><span /></div>

        <div className="game-hud">
          <button className="mini" onClick={playing ? pause : onQuit} title="Esc">{playing ? "❚❚ Pause" : "← Menu"}</button>
          {round && phase !== "loading" && <strong className="target">Find the {targetName}</strong>}
          {playing && (
            <>
              <span className="charge" title="charge">
                {Array.from({ length: CAPACITY }, (_, i) => <i key={i} className={i < charge ? "on" : ""} />)}
              </span>
              <span className="dim small">{shots} splat{shots === 1 ? "" : "s"} · {elapsed.toFixed(1)}s{wrong ? ` · ${wrong} wrong` : ""}</span>
              <button className={pickMode ? "mini is-on" : "mini"} onClick={() => setPickMode((p) => !p)}>
                {pickMode ? "picking (P)" : "pick mode (P)"}
              </button>
            </>
          )}
          <span className="dim small hud-room">{sceneId}{best ? ` · best ${best.best}` : ""}</span>
        </div>

        {phase === "hunting" && (
          <div className="game-foot">
            <button className="go" onClick={() => fire("shot")} disabled={charge < 1}>Splat (space)</button>
            <button className="mini" onClick={() => fire("spray")} disabled={charge < SPRAY_COST}>Spray ×20 (shift-space, {SPRAY_COST})</button>
            <span className="dim small">drag to look · {pickMode ? "click the thing you spy" : "shoot to light the room, then switch to pick mode"}</span>
          </div>
        )}

        {message && phase === "hunting" && <div className="game-msg">{message}</div>}
        {status && phase !== "failed" && <div className="status">{status}</div>}

        {phase === "paused" && (
          <div className="overlay">
            <div className="panel">
              <h2>Paused</h2>
              <p className="dim">Find the {targetName} · {elapsed.toFixed(1)}s · {shots} splat{shots === 1 ? "" : "s"}</p>
              <button className="big go" onClick={resume}>Resume</button>
              <button className="big" onClick={start}>New target</button>
              <button className="big" onClick={onRooms}>Choose a room</button>
              <button className="big" onClick={onQuit}>Quit to menu</button>
            </div>
          </div>
        )}

        {phase === "found" && result && (
          <div className="overlay overlay-clear">
            <div className="panel">
              <p className="kicker">Found the {targetName}</p>
              <div className="stars" aria-label={`${stars(result.points)} of 3 stars`}>
                {[1, 2, 3].map((n) => <span key={n} className={n <= stars(result.points) ? "on" : ""}>★</span>)}
              </div>
              <p className="points">{result.points}{result.newBest && <span className="badge">new best</span>}</p>
              <p className="dim">{result.seconds.toFixed(1)}s · {result.splats} splat{result.splats === 1 ? "" : "s"} · {result.wrong} wrong</p>
              <button className="big go" onClick={start}>Next hunt (space)</button>
              <button className="big" onClick={onAnotherRoom}>Another room</button>
              <button className="big" onClick={onQuit}>Menu</button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="overlay">
            <div className="panel">
              <h2>Can't hunt here</h2>
              <p className="dim">{status}</p>
              <button className="big go" onClick={onAnotherRoom}>Another room</button>
              <button className="big" onClick={onQuit}>Menu</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
