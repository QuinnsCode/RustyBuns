import { useEffect, useRef, useState } from "react";
import { DEFAULT_OPTIONS, type RigOptions } from "../rig/analyze.ts";
import { gingerbread, lizard } from "../rig/samples.ts";
import { hasHost, LANES, runBest, runHost, runPage, type Lane, type Run } from "../rig/run.ts";
import { fromRaw, loadGlb, SAMPLES, type Model } from "./model.ts";
import { Stage, type StageState } from "./stage.ts";

type Pick = "auto" | Lane;
interface Race { lane: Lane; ms: number | null; note?: string }

export function App() {
  const view = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<RigOptions>(DEFAULT_OPTIONS);
  const [pick, setPick] = useState<Pick>("auto");
  const [host, setHost] = useState(false);
  const [race, setRace] = useState<Race[] | null>(null);
  const [st, setSt] = useState<StageState>({ tips: [], selected: null, rootPinned: false, clasped: null });
  const [show, setShow] = useState({ weights: false, skeleton: true });

  useEffect(() => {
    const s = new Stage(view.current!);
    s.onState = setSt;
    stage.current = s;
    hasHost().then(setHost);
    void open("gingerbread");
    return () => s.dispose();
  }, []);

  async function open(id: string, file?: File) {
    setError(null); setRun(null); setRace(null);
    setBusy("Loading…");
    try {
      let m: Model;
      if (file) m = await loadGlb(await file.arrayBuffer(), file.name);
      else if (id === "gingerbread") m = fromRaw(gingerbread(), "Gingerbread");
      else if (id === "lizard") m = fromRaw(lizard(), "Lizard");
      else {
        const s = SAMPLES.find((x) => x.id === id)!;
        const r = await fetch(s.url!);
        if (!r.ok) throw new Error(`download failed: ${r.status}`);
        m = await loadGlb(await r.arrayBuffer(), s.label, s.credit);
      }
      setModel(m);
      stage.current!.setModel(m);
      await rig(m);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function lane(m: Model, l: Pick): Promise<Run> {
    if (l === "auto") return runBest(m.positions, m.indices, opts);
    if (l === "page-ts") return runPage(m.positions, m.indices, opts);
    return runHost(m.positions, m.indices, opts, l === "host-rust" ? "rust" : "ts");
  }

  async function rig(m = model) {
    if (!m) return;
    setError(null);
    setBusy("Finding the skeleton…");
    try {
      const r = await lane(m, pick);
      setRun(r);
      stage.current!.setRig(m, r.rig);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function raceLanes() {
    if (!model) return;
    setBusy("Racing…");
    const out: Race[] = [];
    for (const l of ["host-rust", "host-ts", "page-ts"] as Lane[]) {
      if (l !== "page-ts" && !host) { out.push({ lane: l, ms: null, note: "desktop app only" }); continue; }
      try { const r = await lane(model, l); out.push({ lane: l, ms: r.ms }); }
      catch (e) { out.push({ lane: l, ms: null, note: String((e as Error).message ?? e).slice(0, 60) }); }
      setRace([...out]);
    }
    setBusy(null);
  }

  async function exportGlb() {
    const bytes = await stage.current!.exportGlb();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
    a.download = `${(model?.name ?? "model").replace(/\.glb$/i, "")}-rigged.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function toggle(k: keyof typeof show) {
    const next = { ...show, [k]: !show[k] };
    setShow(next);
    stage.current!.setView(next);
  }

  const tips = run ? [...run.rig.parents].filter((_, j) => !run.rig.parents.includes(j)).length : 0;
  const t = run?.rig.timings;
  const fastest = race ? Math.min(...race.filter((r) => r.ms !== null).map((r) => r.ms!)) : 0;

  return (
    <div className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void open("file", f); }}>
      <aside>
        <header>
          <h1>Auto Rig</h1>
          <p>Drop in a model. Get a skeleton, skin weights and IK you can drag.</p>
        </header>

        <section>
          <h2>Model</h2>
          <div className="row wrap">
            {SAMPLES.map((s) => <button key={s.id} onClick={() => open(s.id)} disabled={!!busy}>{s.label}</button>)}
            <label className="button">Open .glb…<input type="file" accept=".glb,.gltf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void open("file", f); e.target.value = ""; }} /></label>
          </div>
          {model && <p className="dim">{model.name} · {model.triangles.toLocaleString()} triangles · {model.parts.length} mesh{model.parts.length > 1 ? "es" : ""}</p>}
          {model?.credit && <p className="credit">{model.credit}</p>}
          <p className="dim">Or drop a .glb anywhere. Any existing rig is replaced.</p>
        </section>

        <section>
          <h2>Rig</h2>
          <Slider label="Voxels" value={opts.resolution} min={48} max={256} step={8} onChange={(v) => setOpts({ ...opts, resolution: v })} />
          <Slider label="Slices" value={opts.bands} min={16} max={128} step={4} onChange={(v) => setOpts({ ...opts, bands: v })} />
          <Slider label="Bone length" value={opts.boneLength} min={0.05} max={0.3} step={0.01} onChange={(v) => setOpts({ ...opts, boneLength: v })} />
          <Slider label="Seal holes" value={opts.seal} min={0} max={3} step={1} onChange={(v) => setOpts({ ...opts, seal: v })} />
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value as Pick)}>
              <option value="auto">Fastest available</option>
              {(Object.keys(LANES) as Lane[]).map((l) => <option key={l} value={l} disabled={l !== "page-ts" && !host}>{LANES[l]}</option>)}
            </select>
            <button className="primary" onClick={() => rig()} disabled={!model || !!busy}>Rig it</button>
          </div>
          {run && t && (
            <div className="stats">
              <p><b>{run.rig.parents.length}</b> joints · <b>{tips}</b> tips · {run.rig.grid.solid.toLocaleString()} solid voxels</p>
              <p className="dim">{LANES[run.lane]} · {run.ms.toFixed(0)} ms total</p>
              <table><tbody>
                <tr><td>voxelize</td><td>{t.voxelize.toFixed(1)} ms</td></tr>
                <tr><td>thickness + geodesic</td><td>{t.distance.toFixed(1)} ms</td></tr>
                <tr><td>skeleton</td><td>{t.skeleton.toFixed(1)} ms</td></tr>
                <tr><td>skin weights</td><td>{t.weights.toFixed(1)} ms</td></tr>
              </tbody></table>
            </div>
          )}
          <button onClick={raceLanes} disabled={!model || !!busy}>Race the engines</button>
          {race && (
            <table className="race"><tbody>
              {race.map((r) => (
                <tr key={r.lane}><td>{LANES[r.lane]}</td>
                  <td>{r.ms === null ? <span className="dim">{r.note}</span> : <>{r.ms.toFixed(0)} ms{r.ms === fastest ? " ★" : ` · ${(r.ms / fastest).toFixed(1)}×`}</>}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>

        {st.tips.length > 0 && (
          <section>
            <h2>Pose</h2>
            <p className="dim">Click a handle and drag the arrows. Pinned tips (orange) hold still; free ones (gray) follow. Select one tip, then shift-click another to clasp them.</p>
            <label className="check"><input type="checkbox" checked={st.rootPinned} onChange={(e) => stage.current!.setRootPinned(e.target.checked)} /> Pin the root (blue cube)</label>
            <ul className="tips">
              {st.tips.map((tp) => (
                <li key={tp.index} className={st.selected === tp.index ? "sel" : ""}>
                  <label className="check"><input type="checkbox" checked={tp.pinned} onChange={(e) => stage.current!.setPinned(tp.index, e.target.checked)} /> {tp.label}</label>
                  <button className="small" onClick={() => stage.current!.select(tp.index)}>drag</button>
                </li>
              ))}
            </ul>
            {st.clasped && <p>Clasped: tips {st.tips.findIndex((x) => x.index === st.clasped![0]) + 1} and {st.tips.findIndex((x) => x.index === st.clasped![1]) + 1} <button className="small" onClick={() => stage.current!.unclasp()}>let go</button></p>}
            <div className="row">
              <button onClick={() => stage.current!.resetPose()}>Reset pose</button>
              <button onClick={exportGlb}>Download rigged .glb</button>
            </div>
          </section>
        )}

        <section>
          <h2>View</h2>
          <label className="check"><input type="checkbox" checked={show.weights} onChange={() => toggle("weights")} /> Skin weights</label>
          <label className="check"><input type="checkbox" checked={show.skeleton} onChange={() => toggle("skeleton")} /> Skeleton and handles</label>
        </section>
      </aside>
      <main ref={view}>
        {busy && <div className="busy">{busy}</div>}
        {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
      </main>
    </div>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <output>{p.step < 1 ? p.value.toFixed(2) : p.value}</output>
    </label>
  );
}
