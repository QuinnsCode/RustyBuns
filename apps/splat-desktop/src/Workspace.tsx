import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatBytes, type Scene, type SceneInfo, type Status } from "./api.ts";
import { addToScene, editorSrc, hasUnsavedChanges } from "./editorBridge.ts";

export function Workspace({ status, onClose }: { status: Status; onClose: () => void }) {
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [current, setCurrent] = useState<Scene | null>(null);
  const [src, setSrc] = useState(editorSrc(null));
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<SceneInfo | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // Scene info for the open scene. Re-read when the list reloads (the file may have changed).
  useEffect(() => {
    setInfo(null);
    if (!current) return;
    let live = true;
    api.info(current.path).then((i) => live && setInfo(i), () => {});
    return () => { live = false; };
  }, [current, scenes]);

  const load = useCallback(() => api.scenes().then((r) => setScenes(r.scenes), (e) => setNotice(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const es = new EventSource("/api/library/events");
    let t: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (e) => { if (JSON.parse(e.data).type === "changed") { clearTimeout(t); t = setTimeout(load, 300); } };
    return () => { clearTimeout(t); es.close(); };
  }, [load]);

  const confirmDiscard = () => !hasUnsavedChanges(frame.current) || confirm("The editor has unsaved changes. Discard them?");
  const open = (s: Scene | null) => {
    if (!confirmDiscard()) return;
    setCurrent(s);
    setSrc(`${editorSrc(s)}${editorSrc(s).includes("?") ? "&" : "?"}t=${Date.now()}`);   // always a fresh editor
    setNotice(null);
  };
  const add = async (s: Scene) => {
    setNotice(`Adding ${s.name}…`);
    try { await addToScene(frame.current, s); setNotice(`Added ${s.name} to the scene`); }
    catch (e) { setNotice((e as Error).message); }
  };

  return (
    <div className="workspace">
      <aside className="library" aria-label="Scene library">
        <header>
          <strong title={status.library?.dir}>{status.library?.name}</strong>
          <button className="link" onClick={() => confirmDiscard() && onClose()}>Switch</button>
        </header>
        <button className="new" onClick={() => open(null)}>Empty editor</button>
        {scenes === null && <p className="muted">Scanning…</p>}
        {scenes?.length === 0 && <p className="muted">No splat files in this folder yet. Drop .ply, .spz, .sog or .splat files into it and they'll appear here.</p>}
        <ul className="plain scenes">
          {scenes?.map((s) => (
            <li key={s.path} className={current?.path === s.path ? "active" : ""}>
              <button className="open" onClick={() => open(s)} title={`Open ${s.path}`}>
                <span className="name">{s.path}</span>
                <span className="size">{formatBytes(s.bytes)}</span>
              </button>
              <button className="add" onClick={() => add(s)} title={`Add ${s.name} to the open scene`} aria-label={`Add ${s.name} to the open scene`}>+</button>
            </li>
          ))}
        </ul>
        {current && <SceneInfoPanel scene={current} info={info} />}
        {notice && <p className="notice" role="status">{notice}</p>}
        <footer><a href="/THIRD_PARTY_LICENSES.txt" target="_blank" rel="noreferrer">Open-source licenses</a></footer>
      </aside>
      <iframe ref={frame} className="editor" src={src} title="SuperSplat editor" allow="fullscreen; clipboard-read; clipboard-write" />
    </div>
  );
}

function SceneInfoPanel({ scene, info }: { scene: Scene; info: SceneInfo | null }) {
  const size = info?.bounds && info.bounds.max.map((v, i) => v - info.bounds!.min[i]!);
  return (
    <section className="info" aria-label={`Details for ${scene.name}`}>
      <h2>{scene.name}</h2>
      {!info ? <p className="muted">Reading…</p> : (
        <dl>
          <dt>Splats</dt><dd>{info.splats?.toLocaleString() ?? "unknown"}</dd>
          <dt>Detail</dt><dd>{info.shDegree == null ? "unknown" : info.shDegree === 0 ? "flat color" : `SH degree ${info.shDegree}`}</dd>
          <dt>Size</dt><dd>{size ? size.map((v) => v.toFixed(2)).join(" × ") : "unknown"}</dd>
          <dt>File</dt><dd>{formatBytes(scene.bytes)}, {info.format}</dd>
        </dl>
      )}
      {info?.note && <p className="muted small">{info.note}</p>}
    </section>
  );
}
