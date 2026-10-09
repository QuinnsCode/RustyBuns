// First run: the Meshy key, then a workspace folder.
import { useEffect, useState } from "react";
import { api, type Status } from "./api.ts";
import { KeyField } from "./Settings.tsx";

export function Setup({ status, onDone }: { status: Status; onDone: () => void }) {
  return (
    <main className="setup">
      <section className="hero">
        <div className="brand"><span className="mark" aria-hidden>◆</span> MESHY <span className="slash">//</span> BATCH STUDIO</div>
        <h1>Concept art in. Game-ready models out.</h1>
        <p>Drop a folder of labelled concept images, send them to Meshy's Image to 3D, and get game-ready <code>.glb</code> files back, already scaled with the origin where you want it.</p>
      </section>
      <KeyStep status={status} onDone={onDone} />
      {status.hasKey && <FolderStep status={status} onDone={onDone} />}
    </main>
  );
}

function KeyStep({ status, onDone }: { status: Status; onDone: () => void }) {
  return (
    <section className="step plate">
      <h2><span className="num">1</span> Your Meshy API key</h2>
      <KeyField status={status} onSaved={onDone} />
    </section>
  );
}

function FolderStep({ status, onDone }: { status: Status; onDone: () => void }) {
  const [browse, setBrowse] = useState<Awaited<ReturnType<typeof api.list>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (dir: string) => api.list(dir).then(setBrowse, (e) => setError(e.message));
  useEffect(() => { go(status.home); }, []);
  const open = (dir: string) => api.open(dir).then(onDone, (e) => setError(e.message));
  const pick = async () => {
    const r = await api.pick().catch(() => ({ supported: false, dir: null }));
    if (r.dir) open(r.dir);
    else if (!r.supported) setError("No system folder dialog here. Pick a folder from the list below.");
  };

  return (
    <section className="step plate">
      <h2><span className="num">2</span> A workspace folder</h2>
      <p className="muted">The app makes four folders in it: <code>000_to_be_meshyd</code> for your images, <code>already done</code> inside it for sent ones, <code>001_has_been_meshyd</code> for Meshy's raw models and <code>002_ready</code> for the scaled ones.</p>
      <div className="row"><button className="primary" onClick={pick}>Choose folder…</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {status.recent.length > 0 && (
        <>
          <h3>Recent</h3>
          <ul className="plain recent">{status.recent.map((d) => <li key={d}><button className="link" title={d} onClick={() => open(d)}><bdi dir="ltr">{d}</bdi></button></li>)}</ul>
        </>
      )}
      {browse && (
        <>
          <h3>Browse</h3>
          <div className="row">
            <button className="ghost" onClick={() => go(browse.parent)} disabled={browse.parent === browse.dir}>Up</button>
            <code className="path"><bdi dir="ltr">{browse.dir}</bdi></code>
          </div>
          <ul className="plain dirs">
            {browse.dirs.map((d) => <li key={d}><button className="link" onClick={() => go(`${browse.dir}/${d}`)}>{d}/</button></li>)}
            {browse.dirs.length === 0 && <li className="muted">No subfolders.</li>}
          </ul>
          <button className={browse.isWorkspace ? "primary" : "ghost"} onClick={() => open(browse.dir)}>
            {browse.isWorkspace ? "Open this workspace" : "Use this folder"}
          </button>
        </>
      )}
    </section>
  );
}
