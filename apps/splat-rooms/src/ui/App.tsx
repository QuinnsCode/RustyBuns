import { useEffect, useMemo, useRef, useState } from "react";
import { listScenes, readScene, type SceneDetail, type SceneSummary } from "../actions/scenes.ts";
import { Viewer } from "../viewer/viewer.ts";
import { Game } from "./Game.tsx";
import "./app.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";

// Architecture, not findable things: hidden from the object list by default.
const STRUCTURAL = new Set(["wall", "floor", "ceiling", "window", "door", "downlights", "Spotlight", "Linear lamp", "Track Light", "central air-conditioning"]);

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [scenes, setScenes] = useState<SceneSummary[] | null>(null);
  const [dir, setDir] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showStructural, setShowStructural] = useState(false);
  const [filter, setFilter] = useState("");
  const [openKinds, setOpenKinds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"browse" | "play">("browse");

  useEffect(() => {
    listScenes().then((r) => { setScenes(r.scenes); setDir(r.dir); setListError(r.error ?? null); }, (e) => setListError(String(e.message ?? e)));
  }, []);

  // One viewer for the life of the page; scenes swap inside it.
  useEffect(() => {
    if (tab !== "browse" || !canvasRef.current) return;
    const v = new Viewer(canvasRef.current, {
      onPick: (p) => setSelected(p?.ins_id ?? null),
      onProgress: setStatus,
    });
    viewer.current = v;
    const fit = () => { const r = wrapRef.current?.getBoundingClientRect(); if (r) v.resize(r.width, r.height); };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { ro.disconnect(); v.destroy(); viewer.current = null; };
  }, [tab]);

  async function open(id: string) {
    setStatus("Reading scene…"); setSelected(null); setScene(null);
    try {
      const d = await readScene(id);
      setScene(d);
      await viewer.current?.load(d.plyUrl, d.objects);
      if (!d.plyUrl) setStatus("Labels only: no 3dgs_compressed.ply in this folder. Boxes are shown; download the PLY to see the room.");
    } catch (e) { setStatus(`Failed: ${(e as Error).message}`); }
  }

  useEffect(() => { viewer.current?.setShowAllBoxes(showAll); }, [showAll]);

  // Getting lost inside the splats is easy, so F always gets you back out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f" && !(e.target instanceof HTMLInputElement)) viewer.current?.frameRoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byKind = useMemo(() => {
    const m = new Map<string, { ins_id: string; label: string }[]>();
    for (const o of scene?.objects ?? []) {
      if (!o.bounding_box) continue;
      if (!showStructural && STRUCTURAL.has(o.label)) continue;
      if (filter && !o.label.toLowerCase().includes(filter.toLowerCase())) continue;
      (m.get(o.label) ?? m.set(o.label, []).get(o.label)!).push({ ins_id: o.ins_id, label: o.label });
    }
    return [...m.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
  }, [scene, showStructural, filter]);

  const selObj = scene?.objects.find((o) => o.ins_id === selected);

  return (
    <div className={tab === "play" ? "shell shell-play" : "shell"}>
      <aside className="rail">
        <h1>Splat Rooms</h1>
        <div className="tabs">
          <button className={tab === "browse" ? "tab is-on" : "tab"} onClick={() => setTab("browse")}>Browse</button>
          <button className={tab === "play" ? "tab is-on" : "tab"} onClick={() => setTab("play")}>Play</button>
        </div>
        {listError && <p className="warn">{listError}</p>}
        {!scenes && !listError && <p className="dim">Looking for scenes…</p>}
        {scenes && (
          <>
            <p className="dim small">{scenes.length} scene{scenes.length === 1 ? "" : "s"} in {dir}</p>
            <ul className="rooms">
              {scenes.map((s) => (
                <li key={s.id}>
                  <button className={s.id === scene?.id ? "room is-on" : "room"} onClick={() => open(s.id)}>
                    <strong>{s.id}</strong>
                    <span className="dim small">{s.kinds} kinds, {s.objects} objects, {s.hasSplats ? `${s.splatMb} MB` : "labels only"}</span>
                    <span className="dim small">{s.top.map(([k, n]) => `${k}×${n}`).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {tab === "play" ? (scenes?.length ? <Game scenes={scenes} /> : <main className="stage"><p className="dim" style={{ padding: 20 }}>No scenes found yet.</p></main>) : (
      <main className="stage" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="hud">
          <label className="chk"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> all boxes</label>
          <button className="mini" onClick={() => viewer.current?.frameRoom()}>frame room</button>
          <span className="dim small">drag orbit · shift-drag pan · wheel zoom · click to select · F frames the room</span>
        </div>
        {status && <div className="status">{status}</div>}
        {selObj && (
          <div className="card">
            <strong>{selObj.label}</strong>
            <span className="dim small">id {selObj.ins_id}</span>
          </div>
        )}
      </main>
      )}

      {tab === "browse" && <aside className="rail rail-right">
        {!scene ? <p className="dim">Pick a room.</p> : (
          <>
            <h2>Objects</h2>
            <input className="find" placeholder="filter labels" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="chk"><input type="checkbox" checked={showStructural} onChange={(e) => setShowStructural(e.target.checked)} /> show walls, floors, lights</label>
            <p className="dim small">{byKind.length} kinds, rarest first</p>
            <ul className="kinds">
              {byKind.map(([kind, items]) => {
                const open = openKinds.has(kind) || items.length === 1;
                return (
                  <li key={kind}>
                    <button className="kind" onClick={() => setOpenKinds((s) => { const n = new Set(s); n.has(kind) ? n.delete(kind) : n.add(kind); return n; })}>
                      <span>{kind}</span><span className="count">{items.length}</span>
                    </button>
                    {open && (
                      <ul className="insts">
                        {items.slice(0, 40).map((o) => (
                          <li key={o.ins_id}>
                            <button className={o.ins_id === selected ? "inst is-on" : "inst"}
                              onClick={() => { setSelected(o.ins_id); viewer.current?.select(o.ins_id); }}>
                              {kind} · {o.ins_id}
                            </button>
                          </li>
                        ))}
                        {items.length > 40 && <li className="dim small">…{items.length - 40} more</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>}
    </div>
  );
}
