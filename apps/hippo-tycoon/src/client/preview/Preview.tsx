// The dev preview page (`bun run dev`, then /preview or ?preview=finale|round|turntable).
// It drives the real renderer from hand-made frames: pick scores and seats and scrub the
// finale, pose the hippos and fire the geyser, or turn a hippo round at full size. It is
// only imported behind import.meta.env.DEV (see main.tsx), so production builds leave it out.
//
// Everything can be set from the URL too, for links and screenshots:
//   ?preview=finale&scores=0,40,10,25&names=0:Ryan&mine=1&styles=spin,slam,star&t=3.1
//   ?preview=round&pose=1:roar,2:sputter&belt=0&drops=1&erupt=gold
//   ?preview=turntable&seat=2&angle=0.6&spin=0&pose=snarl
//   any of them: &quality=low&film=0&motion=reduced
import { useEffect, useMemo, useRef, useState } from "react";
import { GOLD, OIL, SEATS, SEAT_NAMES } from "../../sim/rules.ts";
import { Renderer } from "../render/index.ts";
import { STYLES, type Style } from "../render/cinematic.ts";
import { LOOKS } from "../render/looks.ts";
import { stillFrame } from "../render/still.ts";
import { QUALITIES, type Quality, type ViewSettings } from "../settings.ts";
import { Hud } from "../ui/Hud.tsx";
import { Seg } from "../ui/Menu.tsx";
import { REST, Turntable, type Pose } from "./turntable.ts";
import "./preview.css";

type Tab = "finale" | "round" | "turntable";
type PoseKey = "roar" | "snarl" | "sputter" | "sore";
const POSES: PoseKey[] = ["roar", "snarl", "sputter", "sore"];
const DROPS = [{ id: 1, kind: 0, x: -6, y: -3 }, { id: 2, kind: 1, x: -3, y: -4.6 }, { id: 3, kind: 2, x: 0, y: -5.2 }, { id: 4, kind: 3, x: 3, y: -4.6 }, { id: 5, kind: 4, x: 6, y: -3 }];

function fromUrl() {
  const q = new URLSearchParams(location.search), list = (k: string) => (q.get(k) ?? "").split(",").filter(Boolean);
  const tab = (["finale", "round", "turntable"] as Tab[]).find((t) => t === q.get("preview")) ?? "finale";
  const scores = list("scores").length === SEATS ? list("scores").map(Number) : [0, 40, 10, 25];
  const seats = Array.from({ length: SEATS }, (_, i) => ({ name: "", human: false, i }));
  for (const kv of list("names")) { const [i, n] = kv.split(":"); if (seats[Number(i)]) seats[Number(i)] = { name: n ?? "", human: true, i: Number(i) }; }
  const poses = Array.from({ length: SEATS }, () => ({ ...REST }));
  for (const kv of list("pose")) { const [a, b] = kv.split(":"); const seat = b ? Number(a) : -1, key = (b ?? a) as PoseKey; for (const p of seat < 0 ? poses : [poses[seat]!]) if (POSES.includes(key)) p[key] = true; }
  for (const s of list("belt")) if (poses[Number(s)]) poses[Number(s)]!.belt = true;
  return {
    tab, scores, seats: seats.map(({ name, human }) => ({ name, human })), poses,
    mine: q.has("mine") ? Number(q.get("mine")) : -1,
    styles: list("styles").map((s) => (STYLES.includes(s as Style) ? (s as Style) : undefined)),
    t: q.has("t") ? Number(q.get("t")) : null,
    drops: q.get("drops") === "1", erupt: q.get("erupt"),
    seat: q.has("seat") ? Number(q.get("seat")) : 0, angle: q.has("angle") ? Number(q.get("angle")) : 0.5, spin: q.get("spin") !== "0",
    view: { quality: (QUALITIES.find((x) => x === q.get("quality")) ?? "high") as Quality, filmLook: q.get("film") !== "0", reducedMotion: q.get("motion") === "reduced" },
  };
}

export function Preview() {
  const init = useMemo(fromUrl, []);
  const [tab, setTab] = useState<Tab>(init.tab);
  const [scores, setScores] = useState(init.scores);
  const [seats, setSeats] = useState(init.seats);
  const [mine, setMine] = useState(init.mine);
  const [styles, setStyles] = useState<(Style | undefined)[]>(init.styles);
  const [poses, setPoses] = useState<Pose[]>(init.poses);
  const [drops, setDrops] = useState(init.drops);
  const [view, setView] = useState<ViewSettings>(init.view);
  const [tt, setTt] = useState({ seat: init.seat, spin: init.spin, pose: { ...REST, ...init.poses[0] } as Pose });
  const [status, setStatus] = useState({ clock: 0, duration: 0, paused: false, playing: false, calls: 0, fluid: "" });
  const stage = useRef<HTMLCanvasElement>(null), turn = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null);
  const r = useRef<Renderer | null>(null), tr = useRef<Turntable | null>(null);
  const state = useRef({ tab, scores, seats, mine, poses, drops }); state.current = { tab, scores, seats, mine, poses, drops };

  useEffect(() => {
    const renderer = (r.current = new Renderer(stage.current!, overlay.current!, { view: init.view }));
    const table = (tr.current = new Turntable(turn.current!)); table.seat = init.seat; table.angle = init.angle; table.spin = init.spin;
    renderer.styles = init.styles;
    (window as unknown as { __preview: unknown }).__preview = { renderer, turntable: table };
    let raf = 0, lastUi = 0, first = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = state.current;
      if (s.tab === "turntable") { table.draw(now); return; }
      const human = s.seats.map((x, i) => ({ name: x.human ? x.name || `Player ${i + 1}` : SEAT_NAMES[i]!, human: x.human, mine: i === s.mine }));
      const round = s.tab === "round";
      if (round) s.poses.forEach((p, i) => { renderer.setBelt(i, p.belt); if (p.snarl) renderer.snarl(i, 400); });
      renderer.draw(stillFrame({
        phase: round ? "playing" : "podium", scores: s.scores, seats: human, mine: s.mine >= 0 ? [s.mine] : [],
        hippos: round ? s.poses.map((p) => ({ bellow: p.roar ? 9 : 0, sputter: p.sputter ? 9 : 0, sore: p.sore ? 9 : 0 })) : [],
        drops: round && s.drops ? DROPS : [],
      }), now);
      if (first && init.t !== null && s.tab === "finale") renderer.seek(init.t);
      if (first && init.erupt) renderer.erupt(init.erupt === "gold" ? GOLD : OIL, init.erupt === "surge" ? 2.5 : 1);
      first = false;
      if (now - lastUi > 100) { lastUi = now; const f = renderer.finale; setStatus({ clock: f.clock, duration: f.duration, paused: f.paused, playing: f.playing, calls: renderer.drawCalls, fluid: renderer.fluidEngine }); }
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => { renderer.resize(); table.resize(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); renderer.dispose(); table.dispose(); };
  }, [init]);

  // any change to the finale's inputs plays it again from the bell
  useEffect(() => { if (r.current) { r.current.styles = styles; r.current.replayFinale(); } }, [scores, seats, mine, styles]);
  useEffect(() => { r.current?.setView(view); }, [view]);
  useEffect(() => { const t = tr.current; if (t) { t.seat = tt.seat; t.spin = tt.spin; t.pose = tt.pose; } }, [tt]);
  useEffect(() => { requestAnimationFrame(() => { r.current?.resize(); tr.current?.resize(); }); }, [tab]);
  useEffect(() => { const q = new URLSearchParams(location.search); q.set("preview", tab); history.replaceState(null, "", `?${q}`); }, [tab]);

  const setPose = (seat: number, k: keyof Pose, v: boolean) => setPoses((ps) => ps.map((p, i) => (i === seat ? { ...p, [k]: v } : p)));
  const losers = scores.filter((s) => s < Math.max(...scores)).length;
  const frame = useMemo(() => stillFrame({ phase: "playing", scores, seats: seats.map((x, i) => ({ name: x.human ? x.name || `Player ${i + 1}` : SEAT_NAMES[i]!, human: x.human })), mine: mine >= 0 ? [mine] : [] }), [scores, seats, mine]);
  const L = LOOKS[Math.max(0, tt.seat)]!;

  return (
    <div className="pv">
      <div className="pv-stage">
        <canvas ref={stage} style={{ display: tab === "turntable" ? "none" : "block" }} />
        <canvas ref={turn} style={{ display: tab === "turntable" ? "block" : "none" }} />
        <div className="layer" ref={overlay} />
        {tab === "round" && <Hud frame={{ ...frame, cur: { ...frame.cur, left: 45 * 30 } }} />}
      </div>
      <aside className="pv-panel">
        <h1>Preview <small>dev only</small></h1>
        <Seg<Tab> name="View" value={tab} options={["finale", "round", "turntable"]} onChange={setTab} />

        {tab === "finale" && <section>
          <h2>Seats and scores</h2>
          {scores.map((s, i) => (
            <div className="pv-seat" key={i}>
              <span className="sw" style={{ background: `#${LOOKS[i]!.accent.toString(16).padStart(6, "0")}` }} />
              <input type="number" aria-label={`${SEAT_NAMES[i]} score`} value={s} onChange={(e) => setScores(scores.map((x, k) => (k === i ? Number(e.target.value) : x)))} />
              <label><input type="checkbox" checked={seats[i]!.human} onChange={(e) => setSeats(seats.map((x, k) => (k === i ? { ...x, human: e.target.checked } : x)))} /> human</label>
              <input className="nm" aria-label={`${SEAT_NAMES[i]} name`} placeholder={SEAT_NAMES[i]} disabled={!seats[i]!.human} value={seats[i]!.name} onChange={(e) => setSeats(seats.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <label><input type="radio" name="mine" checked={mine === i} onChange={() => setMine(i)} /> me</label>
            </div>
          ))}
          <label><input type="radio" name="mine" checked={mine < 0} onChange={() => setMine(-1)} /> spectating (no seat of mine)</label>
          <h2>Toss styles</h2>
          {Array.from({ length: losers }, (_, k) => (
            <div className="row" key={k}><label>Toss {k + 1}</label>
              <Seg<string> name={`Toss ${k + 1} style`} value={styles[k] ?? "auto"} options={["auto", ...STYLES]} onChange={(v) => setStyles(Array.from({ length: Math.max(styles.length, k + 1) }, (_, j) => (j === k ? (v === "auto" ? undefined : (v as Style)) : styles[j])))} />
            </div>
          ))}
          <h2>Transport</h2>
          <input className="pv-scrub" type="range" aria-label="Finale time" min={0} max={Math.max(1, status.duration + 3)} step={0.01} value={status.clock} onChange={(e) => r.current?.seek(Number(e.target.value))} />
          <div className="pv-time">{status.clock.toFixed(2)} s / {status.duration.toFixed(1)} s{status.paused ? " · paused" : ""}</div>
          <div className="row">
            <button className="btn" onClick={() => r.current?.replayFinale()}>From the bell</button>
            <button className="btn" onClick={() => (status.paused ? r.current?.resumeFinale() : r.current?.pauseFinale())}>{status.paused ? "Play" : "Pause"}</button>
            <button className="btn" onClick={() => r.current?.skipFinale()}>Skip</button>
          </div>
        </section>}

        {tab === "round" && <section>
          <h2>Poses</h2>
          {poses.map((p, i) => (
            <div className="pv-seat" key={i}>
              <b style={{ minWidth: 120 }}>{SEAT_NAMES[i]}</b>
              {POSES.map((k) => <label key={k}><input type="checkbox" checked={p[k]} onChange={(e) => setPose(i, k, e.target.checked)} /> {k}</label>)}
              <label><input type="checkbox" checked={p.belt} onChange={(e) => setPose(i, "belt", e.target.checked)} /> belt</label>
            </div>
          ))}
          <h2>Geyser</h2>
          <div className="row">
            <button className="btn" onClick={() => r.current?.erupt(OIL)}>Oil</button>
            <button className="btn" onClick={() => r.current?.erupt(GOLD)}>Gold</button>
            <button className="btn" onClick={() => r.current?.erupt(OIL, 2.5)}>Surge</button>
          </div>
          <label><input type="checkbox" checked={drops} onChange={(e) => setDrops(e.target.checked)} /> show one of each drop</label>
        </section>}

        {tab === "turntable" && <section>
          <h2>Hippo</h2>
          <Seg<number> name="Hippo" value={tt.seat} options={[0, 1, 2, 3, -1]} label={(s) => (s < 0 ? "All" : SEAT_NAMES[s]!.split(" ").pop()!)} onChange={(seat) => setTt({ ...tt, seat })} />
          <label><input type="checkbox" checked={tt.spin} onChange={(e) => setTt({ ...tt, spin: e.target.checked })} /> turning</label>
          <input className="pv-scrub" type="range" aria-label="Angle" min={0} max={6.283} step={0.01} defaultValue={init.angle} onChange={(e) => { if (tr.current) { tr.current.angle = Number(e.target.value); setTt({ ...tt, spin: false }); } }} />
          <h2>Pose</h2>
          <div className="pv-seat">
            {POSES.map((k) => <label key={k}><input type="checkbox" checked={tt.pose[k]} onChange={(e) => setTt({ ...tt, pose: { ...tt.pose, [k]: e.target.checked } })} /> {k}</label>)}
            <label><input type="checkbox" checked={tt.pose.belt} onChange={(e) => setTt({ ...tt, pose: { ...tt.pose, belt: e.target.checked } })} /> belt</label>
          </div>
          {tt.seat >= 0 && <p className="pv-note">{SEAT_NAMES[tt.seat]}: {L.hat} hat, {L.shades} shades{L.bandolier ? `, ${L.bandolier} bandolier${L.bandolier > 1 ? "s" : ""}` : ""}{L.medals ? `, ${L.medals} medals` : ""}{L.epaulettes ? ", epaulettes" : ""}{L.cigar ? ", cigar" : ""}{L.moustache !== null ? ", moustache" : ""}{L.fur ? ", fur collar" : ""}{L.camo ? ", camo" : ""}, {L.chains} chain{L.chains > 1 ? "s" : ""}.</p>}
        </section>}

        <h2>Look</h2>
        <div className="row"><label>Quality</label><Seg<Quality> name="Quality" value={view.quality} options={QUALITIES} onChange={(quality) => setView({ ...view, quality })} /></div>
        <div className="row"><label>Film look</label><Seg<boolean> name="Film look" value={view.filmLook} options={[true, false]} label={(v) => (v ? "On" : "Off")} onChange={(filmLook) => setView({ ...view, filmLook })} /></div>
        <div className="row"><label>Reduced motion</label><Seg<boolean> name="Reduced motion" value={view.reducedMotion} options={[true, false]} label={(v) => (v ? "On" : "Off")} onChange={(reducedMotion) => setView({ ...view, reducedMotion })} /></div>
        <p className="pv-note">{tab === "turntable" ? "turntable" : `${status.calls} draw calls (all passes) · fluid: ${status.fluid}`}</p>
      </aside>
    </div>
  );
}
