import { useEffect, useRef, useState } from "react";
import { readScene, type SceneDetail, type SceneSummary } from "../actions/scenes.ts";
import { planRound, type Candidate, type Round } from "../game/round.ts";
import { GameView } from "../game/view.ts";

const CAPACITY = 12;
const REGEN_MS = 1500;      // one charge every 1.5 s
const SPRAY_COST = 6;
const WRONG_COST = 4;

type Phase = "idle" | "hunting" | "found";

export function Game({ scenes }: { scenes: SceneSummary[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef<GameView | null>(null);
  const [sceneId, setSceneId] = useState<string>(scenes.find((s) => s.hasSplats)?.id ?? scenes[0]?.id ?? "");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [charge, setCharge] = useState(CAPACITY);
  const [shots, setShots] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [seed, setSeed] = useState(1);
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

  async function start(nextSeed = seed) {
    setStatus("Setting up a round…");
    setMessage(null);
    try {
      const d = scene?.id === sceneId ? scene : await readScene(sceneId);
      setScene(d);
      const r = planRound(d, { seed: nextSeed });
      if (!r) { setStatus("No suitable target in this room. Try another."); return; }
      setRound(r);
      await view.current?.startRound(r, d.plyUrl);
      setPhase("hunting");
      setCharge(CAPACITY); setShots(0); setWrong(0); setPickMode(false);
      setStartedAt(Date.now()); setElapsed(0);
      setStatus(null);
    } catch (e) { setStatus(`Failed: ${(e as Error).message}`); }
  }

  useEffect(() => { judgeRef.current = judge; });

  function judge(c: Candidate | null) {
    if (!round || phase !== "hunting") return;
    if (!c) { setMessage("Nothing there."); return; }
    if (c.ins_id === round.target.ins_id) {
      setPhase("found");
      view.current?.revealAll(true);
      view.current?.setHighlight(round.target);
      setMessage(`Found the ${round.target.label}.`);
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

  // Keyboard: space shoots, shift-space sprays, P toggles pick mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") { e.preventDefault(); fire(e.shiftKey ? "spray" : "shot"); }
      if (e.key.toLowerCase() === "p") setPickMode((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const targetName = round?.target.label ?? "";
  return (
    <div className="game">
      <div className="game-stage" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <canvas ref={maskRef} className="mask" />
        <div className="cross" aria-hidden><span /><span /></div>

        <div className="game-hud">
          {phase === "idle" ? (
            <>
              <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
                {scenes.map((s) => <option key={s.id} value={s.id}>{s.id}{s.hasSplats ? "" : " (labels only)"}</option>)}
              </select>
              <button className="go" onClick={() => start()}>Start hunt</button>
            </>
          ) : (
            <>
              <strong className="find">Find the {targetName}</strong>
              <span className="charge" title="charge">
                {Array.from({ length: CAPACITY }, (_, i) => <i key={i} className={i < charge ? "on" : ""} />)}
              </span>
              <span className="dim small">{shots} splats · {elapsed.toFixed(1)}s{wrong ? ` · ${wrong} wrong` : ""}</span>
              <button className={pickMode ? "mini is-on" : "mini"} onClick={() => setPickMode((p) => !p)}>
                {pickMode ? "picking (P)" : "pick mode (P)"}
              </button>
              {phase === "found" && <button className="go" onClick={() => { setSeed((s) => s + 1); start(seed + 1); }}>Next hunt</button>}
            </>
          )}
        </div>

        {phase === "hunting" && (
          <div className="game-foot">
            <button className="go" onClick={() => fire("shot")} disabled={charge < 1}>Splat (space)</button>
            <button className="mini" onClick={() => fire("spray")} disabled={charge < SPRAY_COST}>Spray ×20 (shift-space, {SPRAY_COST})</button>
            <span className="dim small">drag to look · {pickMode ? "click the thing you spy" : "shoot to light the room, then switch to pick mode"}</span>
          </div>
        )}

        {message && <div className="game-msg">{message}</div>}
        {status && <div className="status">{status}</div>}
        {phase === "idle" && !status && (
          <div className="game-intro">
            <h2>Splat hunt</h2>
            <p>The room goes dark. You get a splat gun and a thing to find. Each shot lights a patch of whatever it lands on; charge refills slowly, so a wide spray costs you the next few seconds. When you think you've spotted it, switch to pick mode and click it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
