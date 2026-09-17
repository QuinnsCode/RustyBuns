import { useEffect, useState } from "react";
import { api, type Status } from "./api.ts";

export function Welcome({ status, onOpened }: { status: Status; onOpened: () => void }) {
  const [browse, setBrowse] = useState<Awaited<ReturnType<typeof api.list>> | null>(null);
  const [newName, setNewName] = useState("my-board");
  const [error, setError] = useState<string | null>(null);

  const go = (dir: string) => api.list(dir).then(setBrowse, (e) => setError(e.message));
  useEffect(() => { go(status.home); }, []);

  const open = (dir: string) => api.open(dir).then(onOpened, (e) => setError(e.message));
  const create = (dir: string) => api.create(dir).then(onOpened, (e) => setError(e.message));
  const pick = async () => {
    const r = await api.pick().catch(() => ({ supported: false, dir: null }));
    if (r.dir) open(r.dir);
    else if (!r.supported) setError("No system folder dialog here. Pick a folder from the list below.");
  };

  return (
    <main className="welcome">
      <section className="welcome-hero">
        <h1>tscircuit, on your machine</h1>
        <p>Open a folder of <code>.circuit.tsx</code> files. Edits you save anywhere show up here, and board analysis runs in native Rust.</p>
        <div className="row">
          <button className="primary" onClick={pick}>Open folder…</button>
          <span className={`engine-chip ${status.native ? "on" : ""}`}>
            {status.native ? `Rust engine loaded (${status.platform})` : "Rust engine not built: using TypeScript"}
          </span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {status.recent.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul className="plain">
            {status.recent.map((d) => <li key={d}><button className="link" onClick={() => open(d)}>{d}</button></li>)}
          </ul>
        </section>
      )}

      {browse && (
        <section className="browser">
          <h2>Browse</h2>
          <div className="row path">
            <button onClick={() => go(browse.parent)} disabled={browse.parent === browse.dir} aria-label="Up one folder">Up</button>
            <code>{browse.dir}</code>
          </div>
          <ul className="plain dirs">
            {browse.dirs.map((d) => (
              <li key={d}><button className="link" onClick={() => go(`${browse.dir}/${d}`)}>{d}/</button></li>
            ))}
            {browse.dirs.length === 0 && <li className="muted">No subfolders.</li>}
          </ul>
          <div className="row wrap">
            <button className={browse.hasBoards ? "primary" : ""} onClick={() => open(browse.dir)}>
              Open this folder{browse.hasBoards ? "" : " (no boards yet)"}
            </button>
            <span className="muted">or start a new project inside it:</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New project folder name" />
            <button onClick={() => create(`${browse.dir}/${newName}`)} disabled={!newName.trim()}>Create project</button>
          </div>
        </section>
      )}
    </main>
  );
}
