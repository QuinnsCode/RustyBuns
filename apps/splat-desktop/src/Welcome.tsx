import { useEffect, useState } from "react";
import { api, type Status } from "./api.ts";

export function Welcome({ status, onOpened }: { status: Status; onOpened: () => void }) {
  const [browse, setBrowse] = useState<Awaited<ReturnType<typeof api.list>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (dir: string) => api.list(dir).then(setBrowse, (e) => setError(e.message));
  useEffect(() => { go(status.home); }, []);
  const open = (dir: string) => api.open(dir).then(onOpened, (e) => setError(e.message));
  const pick = async () => {
    const r = await api.pick().catch(() => ({ supported: false, dir: null }));
    if (r.dir) open(r.dir);
    else if (!r.supported) setError("No system folder dialog here. Pick a folder from the list below.");
  };

  return (
    <main className="welcome">
      <section className="hero">
        <h1>Splats, on your machine</h1>
        <p>Open a folder of Gaussian splat scenes (.ply, .spz, .sog, .splat) and edit them in SuperSplat. Files stay on your disk, however large.</p>
        <button className="primary" onClick={pick}>Open folder…</button>
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
        <section>
          <h2>Browse</h2>
          <div className="row">
            <button onClick={() => go(browse.parent)} disabled={browse.parent === browse.dir}>Up</button>
            <code className="path">{browse.dir}</code>
          </div>
          <ul className="plain dirs">
            {browse.dirs.map((d) => <li key={d}><button className="link" onClick={() => go(`${browse.dir}/${d}`)}>{d}/</button></li>)}
            {browse.dirs.length === 0 && <li className="muted">No subfolders.</li>}
          </ul>
          <button className={browse.scenes ? "primary" : ""} onClick={() => open(browse.dir)}>
            Open this folder{browse.scenes ? ` (${browse.scenes} scene${browse.scenes === 1 ? "" : "s"} here)` : ""}
          </button>
        </section>
      )}

      <footer><a href="/THIRD_PARTY_LICENSES.txt" target="_blank" rel="noreferrer">Open-source licenses</a></footer>
    </main>
  );
}
