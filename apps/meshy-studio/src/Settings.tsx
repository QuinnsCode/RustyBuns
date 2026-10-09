// The settings panel: the Meshy key, spend guards, and where finished models go.
import { useEffect, useState } from "react";
import { api, type Engine, type Settings, type Status, type Summary } from "./api.ts";

const QUEUE_LIMITS: [string, number][] = [["Pro", 10], ["Studio", 20], ["Premium", 30], ["Ultra", 100]];

const ENGINES: { id: Engine; name: string; hint: string }[] = [
  { id: "unity", name: "Unity", hint: "Pick a folder under your project's Assets, e.g. Assets/Meshy. Unity imports .glb with the glTFast package (com.unity.cloud.gltfast)." },
  { id: "unreal", name: "Unreal", hint: "Pick a folder under your project's Content, e.g. Content/Meshy. Unreal 5 imports .glb through Interchange; with Auto Reimport on (Editor Preferences → Loading & Saving) new files come in by themselves, otherwise drag them in." },
  { id: "blender", name: "Blender", hint: "Any folder. Ready cards also get an Open in Blender button that loads the models into an empty scene." },
  { id: "folder", name: "Any folder", hint: "A shared drive, or another tool's import folder." },
];

/** The key goes in and never comes back out: masked, never prefilled, no reveal button. */
export function KeyField({ status, onSaved }: { status: Status; onSaved: (balance: number) => void }) {
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(!status.hasKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setReplacing(!status.hasKey); }, [status.hasKey]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { balance } = await api.setKey(key);
      setMsg({ ok: true, text: `Key works. ${balance.toLocaleString()} credits on the account.` });
      setReplacing(false);
      onSaved(balance);
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    setKey("");
    setBusy(false);
  };

  return (
    <div className="keyfield">
      {status.hasKey && !replacing ? (
        <div className="row">
          <span className="sealed" aria-label="API key saved and hidden">●●●●●●●●●●●●●●●●</span>
          <span className="tag ok">{status.keyFromEnv ? "From MESHY_API_KEY" : "Saved · hidden"}</span>
          {!status.keyFromEnv && <>
            <button className="ghost small" onClick={() => setReplacing(true)}>Replace</button>
            <button className="ghost small" onClick={() => api.forgetKey().then(() => onSaved(-1))}>Remove</button>
          </>}
        </div>
      ) : (
        <form className="row" onSubmit={save}>
          <input type="password" name="meshy-key" placeholder="Paste your Meshy API key" value={key} onChange={(e) => setKey(e.target.value)}
            autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" aria-label="Meshy API key" />
          <button className="primary" disabled={!key || busy}>{busy ? "Checking…" : "Check and save"}</button>
          {status.hasKey && <button type="button" className="ghost" onClick={() => { setReplacing(false); setKey(""); }}>Keep the old one</button>}
        </form>
      )}
      {msg && <p className={msg.ok ? "ok small" : "error small"} role="status">{msg.text}</p>}
      <p className="muted small">Make one at <a href="https://www.meshy.ai/settings/api" target="_blank" rel="noreferrer">meshy.ai → Settings → API</a>. It's checked with a free balance call, stored on this computer only (readable by your user only), sent nowhere but api.meshy.ai, and never shown again, not even in part.</p>
    </div>
  );
}

export function SettingsPanel({ status, sum, balance, onClose, onStatus, onSummary, onBalance }: {
  status: Status; sum: Summary; balance: number | null; onClose: () => void;
  onStatus: () => void; onSummary: (s: Summary) => void; onBalance: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(sum.sync?.engine ?? "unity");
  const [dir, setDir] = useState(sum.sync?.dir ?? "");
  const s = status.settings;
  const set = (patch: Partial<Settings>) => api.settings(patch).then(onStatus, (e) => setError(e.message));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  const pick = async () => {
    const r = await api.pick(`Pick the ${ENGINES.find((e) => e.id === engine)!.name} folder for finished models`).catch(() => null);
    if (r?.dir) setDir(r.dir);
    else if (r && !r.supported) setError("No system folder dialog here: type the path instead.");
  };
  const connect = () => api.sync(dir, engine).then((x) => { onSummary(x); setError(null); }, (e) => setError(e.message));

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer plate" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h2>Settings</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close settings">Close</button>
        </header>
        {error && <p className="error small" role="alert">{error}</p>}

        <section>
          <h3>Meshy API key</h3>
          <KeyField status={status} onSaved={() => { onStatus(); onBalance(); }} />
        </section>

        <section>
          <h3>Spending</h3>
          <div className="gauge">
            <span className="label">Balance</span>
            <strong className="credits">{balance === null ? "…" : balance.toLocaleString()}</strong>
            <span className="label">credits</span>
            <button className="ghost small" onClick={onBalance}>Refresh</button>
          </div>
          <p className="muted small">Spent in this workspace so far: {sum.spent.toLocaleString()} credits.</p>
          <label className="check">
            <input type="checkbox" checked={s.confirmSends} onChange={(e) => set({ confirmSends: e.target.checked })} />
            Show the cost and ask before every send
          </label>
          <label className="row">
            <span>Batch limit</span>
            <input type="number" min={0} step={10} defaultValue={s.batchCap} key={s.batchCap} className="num"
              onBlur={(e) => Number(e.target.value) !== s.batchCap && set({ batchCap: Number(e.target.value) })} />
            <span className="muted small">credits per send (0 = none). The app refuses bigger sends, and any send over your balance.</span>
          </label>
          <label className="row">
            <span>Plan queue</span>
            <select value={s.maxQueued} onChange={(e) => set({ maxQueued: Number(e.target.value) })}>
              {QUEUE_LIMITS.map(([n, v]) => <option key={v} value={v}>{n}: {v} at once</option>)}
            </select>
          </label>
        </section>

        <section>
          <h3>Game engine</h3>
          <p className="muted small">Finished models are also copied here, keeping your folders, and re-copied when you resize or rename them.</p>
          <div className="seg" role="radiogroup" aria-label="Engine">
            {ENGINES.map((e) => (
              <button key={e.id} role="radio" aria-checked={engine === e.id} className={engine === e.id ? "on" : ""} onClick={() => setEngine(e.id)}>{e.name}</button>
            ))}
          </div>
          <p className="small hint">{ENGINES.find((e) => e.id === engine)!.hint}</p>
          <div className="row">
            <input className="grow" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/path/to/MyGame/Assets/Meshy" aria-label="Engine folder" />
            <button className="ghost" onClick={pick}>Choose…</button>
          </div>
          <div className="row">
            <button className="primary" disabled={!dir} onClick={connect}>{sum.sync ? "Update" : "Connect"}</button>
            {sum.sync && <button className="ghost" onClick={() => api.syncOff().then(onSummary)}>Disconnect</button>}
          </div>
          {sum.sync && <p className="ok small">Copying to {ENGINES.find((e) => e.id === sum.sync!.engine)?.name}: <code>{sum.sync.dir}</code></p>}
          <p className="muted small">Blender: {status.blender ? "found on this computer." : "not found. Install it, or set BLENDER_PATH."}</p>
        </section>
      </aside>
    </div>
  );
}
