// The workspace: organizing folders on the left; the cards as a folder grid or a pipeline board.
// Drop images anywhere to add them to the open folder; drag a card onto a folder to move it.
// Every send goes through the cost confirmation (unless turned off in Settings).
import { useEffect, useMemo, useState } from "react";
import { api, imageUrl, type Card, type Status, type Summary } from "./api.ts";
import { Board } from "./Board.tsx";
import { ConfirmSend, costOf, type SendAsk, type SendKind } from "./Confirm.tsx";
import { PresetsPanel } from "./Presets.tsx";
import { SettingsPanel } from "./Settings.tsx";

const ALL = "\u0000all";
const folderLabel = (f: string) => f === "" ? "Top folder" : f;
const FINDER = navigator.platform.startsWith("Mac") ? "Finder" : "files";

type View = "folders" | "pipeline";
const savedView = (): View => { try { return localStorage.getItem("meshy-view") === "pipeline" ? "pipeline" : "folders"; } catch { return "folders"; } };

export function Studio({ status, onLeave, onStatus }: { status: Status; onLeave: () => void; onStatus: () => void }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [folder, setFolder] = useState<string>(ALL);
  const [view, setViewState] = useState<View>(savedView);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [ask, setAsk] = useState<SendAsk | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("meshy-view", v); } catch {} };
  const run = (p: Promise<Summary>) => p.then((s) => { setSum(s); setError(null); }, (e) => setError(e.message));
  const refreshBalance = () => api.balance().then((b) => setBalance(b.balance), () => setBalance(null));
  useEffect(() => {
    run(api.jobs());
    const t = setInterval(() => api.jobs().then(setSum, () => {}), 1500);
    return () => clearInterval(t);
  }, []);
  // Credits move as jobs start and finish: refresh when a job changes state, not on every poll.
  const states = sum?.jobs.map((j) => j.state).join() ?? "";
  useEffect(() => { refreshBalance(); }, [states, status.hasKey]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3500); return () => clearTimeout(t); }, [note]);

  const shown = useMemo(() => sum?.jobs.filter((j) => folder === ALL || j.folder === folder) ?? [], [sum, folder]);
  if (!sum) return error ? <p className="fatal">{error}</p> : null;

  const fresh = shown.filter((j) => j.state === "new");
  const drafts = shown.filter((j) => j.state === "done" && !j.textured && (!j.texture || j.texture.state === "failed"));
  const cost = fresh.reduce((n, j) => n + j.estimate, 0);
  const active = sum.jobs.filter((j) => j.state === "queued" || j.state === "running").length;
  const target = folder === ALL ? "" : folder;
  const low = balance !== null && cost > 0 && cost > balance;

  // Spending goes through here: confirm first unless the person turned that off.
  const requestSend = (cards: Card[], kind: SendKind = "shape") => {
    if (!cards.length) return;
    if (status.settings.confirmSends) setAsk({ kind, cards });
    else doSend({ kind, cards }, cards.reduce((n, c) => n + costOf(c, kind), 0), false);
  };
  const doSend = async (a: SendAsk, credits: number, draft: boolean) => {
    setAsk(null);
    const keys = a.cards.map((c) => c.key);
    if (a.kind === "retry") for (const c of a.cards) await run(api.retry(c.key, costOf(c, "retry")));
    else if (a.kind === "texture") await run(api.texture(keys, credits));
    else await run(api.send(keys, credits, draft));
  };
  // A failed scale re-runs for free; a failed Meshy job or texture costs credits again.
  const retry = (cards: Card[]) => {
    const free = cards.filter((c) => c.raw && c.texture?.state !== "failed");
    for (const c of free) run(api.retry(c.key, 0));
    requestSend(cards.filter((c) => !free.includes(c)), "retry");
  };
  const texture = (cards: Card[]) => requestSend(cards, "texture");
  const blender = status.blender ? (cards: Card[]) => api.blender(cards.map((c) => c.key)).then(
    (r) => setNote(`Opening ${r.opened} model${r.opened === 1 ? "" : "s"} in Blender…`), (e) => setError(e.message)) : undefined;

  const upload = async (files: FileList | File[], into = target) => {
    const imgs = [...files].filter((f) => /\.(png|jpe?g)$/i.test(f.name));
    if (!imgs.length) { setError("Only .png and .jpg images can go to Meshy."); return; }
    for (const f of imgs) await run(api.upload(into, f));
  };
  const onDrop = (e: React.DragEvent, into?: string) => {
    e.preventDefault(); e.stopPropagation(); setDropping(false);
    const key = e.dataTransfer.getData("application/x-meshy-card");
    if (key && into !== undefined) run(api.move(key, into));
    else if (e.dataTransfer.files.length) upload(e.dataTransfer.files, into);
  };
  const newFolder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("folder") as HTMLInputElement;
    const name = input.value.trim();
    if (name) run(api.newFolder(target ? `${target}/${name}` : name)).then(() => { input.value = ""; });
  };

  return (
    <div className="studio" onDragOver={(e) => { e.preventDefault(); setDropping(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }} onDrop={(e) => onDrop(e)}>
      <header className="topbar">
        <div className="brand"><span className="mark" aria-hidden>◆</span> MESHY <span className="slash">//</span> BATCH STUDIO</div>
        <div className="ws" title={sum.dir}>{sum.name} <button className="ghost small" onClick={onLeave}>Switch</button></div>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "folders"} className={view === "folders" ? "on" : ""} onClick={() => setView("folders")}>Folders</button>
          <button role="tab" aria-selected={view === "pipeline"} className={view === "pipeline" ? "on" : ""} onClick={() => setView("pipeline")}>Pipeline</button>
        </div>
        <div className={`gauge ${low ? "low" : ""}`} title="Meshy credits on the account">
          <span className="label">Credits</span>
          <strong className="credits">{balance === null ? "—" : balance.toLocaleString()}</strong>
          <span className="label">spent here {sum.spent.toLocaleString()}</span>
        </div>
        <button className="ghost" onClick={() => setPresetsOpen(true)}>Presets</button>
        <button className="ghost" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
      </header>

      <aside className="side">
        <h3>Folders</h3>
        <nav aria-label="Folders">
          <FolderRow label="All images" count={sum.jobs.length} active={folder === ALL} onClick={() => setFolder(ALL)} />
          {sum.folders.map((f) => (
            <FolderRow key={f} label={folderLabel(f)} depth={f ? f.split("/").length : 0}
              count={sum.jobs.filter((j) => j.folder === f).length} active={folder === f}
              onClick={() => setFolder(f)} onDrop={(e) => onDrop(e, f)} />
          ))}
        </nav>
        <form className="row" onSubmit={newFolder}>
          <input name="folder" className="grow small" placeholder={target ? `New folder in ${target}` : "New folder"} aria-label="New folder name" />
          <button className="ghost small">Add</button>
        </form>

        <h3>Open in {FINDER}</h3>
        <div className="stages">
          {([["inbox", "000 to be meshyd"], ["sent", "already done"], ["raw", "001 has been meshyd"], ["ready", "002 ready"]] as const).map(([s, label]) => (
            <button key={s} className="link small" onClick={() => api.reveal(s)}>{label}</button>
          ))}
          <button className="link small" onClick={() => api.reveal("root")}>meshy-presets.json</button>
        </div>

        <h3>Engine</h3>
        <p className="small">{sum.sync
          ? <>Copying to <strong>{sum.sync.engine === "folder" ? "a folder" : sum.sync.engine[0]!.toUpperCase() + sum.sync.engine.slice(1)}</strong><br /><code className="path"><bdi dir="ltr">{sum.sync.dir}</bdi></code></>
          : <button className="link small" onClick={() => setSettingsOpen(true)}>Connect Unity, Unreal or Blender…</button>}</p>
      </aside>

      <main className="main">
        <header className="bar">
          <div>
            <h1>{folder === ALL ? "All images" : folderLabel(folder)}</h1>
            <p className="muted small">{shown.length} image{shown.length === 1 ? "" : "s"}{active ? ` · ${active} with Meshy` : ""}</p>
          </div>
          <label className="button ghost">
            Add images…
            <input type="file" accept=".png,.jpg,.jpeg" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
          {drafts.length > 0 && <button className="ghost" onClick={() => texture(drafts)}>Texture {drafts.length} draft{drafts.length === 1 ? "" : "s"} · ~{drafts.reduce((n, c) => n + c.textureEstimate, 0)}</button>}
          <button className="primary" disabled={!fresh.length} onClick={() => requestSend(fresh)}>
            {fresh.length ? `Send ${fresh.length} · ~${cost} credits` : "Nothing new to send"}
          </button>
        </header>

        {sum.pause && <p className="banner" role="alert">{sum.pause.reason}{!sum.pause.until && <button className="ghost small" onClick={() => run(api.resume())}>Resume</button>}</p>}
        {error && <p className="banner" role="alert">{error}<button className="ghost small" onClick={() => setError(null)}>Dismiss</button></p>}
        {low && <p className="banner">These {fresh.length} need about {cost} credits; the account has {balance}.</p>}

        {shown.length === 0 ? (
          <div className={`empty plate ${dropping ? "over" : ""}`}>
            <p><strong>Drop .png or .jpg images here</strong>, or put them in <code>000_to_be_meshyd/{target}</code> in {FINDER}.</p>
            <p className="muted">The filename is the label: <code>flora_oak_h12_bottom.png</code> uses the Flora preset, scales to 12 m tall, origin at the bottom, and comes out as <code>flora_oak.glb</code>.</p>
          </div>
        ) : view === "pipeline" ? (
          <Board cards={shown} act={{ send: (c) => requestSend(c), texture, retry, cancel: (c) => run(api.cancel(c.key)), blender, say: setNote }} />
        ) : (
          <ul className={`cards ${dropping ? "over" : ""}`}>
            {shown.map((j) => <CardView key={j.key} j={j} sum={sum} run={run} showFolder={folder === ALL}
              onSend={() => requestSend([j])} onRetry={() => retry([j])} onTexture={() => texture([j])} onBlender={blender && (() => blender([j]))} />)}
          </ul>
        )}
      </main>

      {note && <p className="toast" role="status">{note}</p>}
      {ask && <ConfirmSend ask={ask} balance={balance} batchCap={status.settings.batchCap} onCancel={() => setAsk(null)} onConfirm={(n, d) => doSend(ask, n, d)} />}
      {presetsOpen && <PresetsPanel sum={sum} onClose={() => setPresetsOpen(false)} onSaved={setSum} />}
      {settingsOpen && <SettingsPanel status={status} sum={sum} balance={balance} onClose={() => setSettingsOpen(false)}
        onStatus={onStatus} onSummary={setSum} onBalance={refreshBalance} />}
    </div>
  );
}

function FolderRow({ label, count, active, depth = 0, onClick, onDrop }: { label: string; count: number; active: boolean; depth?: number; onClick: () => void; onDrop?: (e: React.DragEvent) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button className={`folder ${active ? "active" : ""} ${over ? "over" : ""}`} style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }} onClick={onClick}
      onDragOver={onDrop && ((e) => { e.preventDefault(); e.stopPropagation(); setOver(true); })}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop && ((e) => { setOver(false); onDrop(e); })}>
      <span>{label}</span><span className="count">{count}</span>
    </button>
  );
}

const STATE_TEXT: Record<Card["state"], string> = { new: "New", queued: "Queued", running: "With Meshy", downloaded: "Scaling", done: "Ready", failed: "Failed" };

function CardView({ j, sum, run, showFolder, onSend, onRetry, onTexture, onBlender }: {
  j: Card; sum: Summary; run: (p: Promise<Summary>) => void; showFolder: boolean;
  onSend: () => void; onRetry: () => void; onTexture: () => void; onBlender?: () => void;
}) {
  const unsent = j.state === "new" || (j.state === "failed" && !j.taskId);
  const editable = unsent || !!j.raw;
  const sizeKind = "height" in j.size ? "height" : "longest" in j.size ? "longest" : "auto";
  const sizeVal = "height" in j.size ? j.size.height : "longest" in j.size ? j.size.longest : 1;
  const setSize = (kind: string, v: number) => (kind === "auto" || v > 0) &&
    run(api.edit(j.key, { size: kind === "auto" ? { auto: true } : kind === "height" ? { height: v } : { longest: v } }));
  const tex = j.texture;
  const texturing = tex?.state === "queued" || tex?.state === "running";
  const canTexture = j.state === "done" && !j.textured && (!tex || tex.state === "failed");
  const failed = j.state === "failed" || tex?.state === "failed";

  return (
    <li className={`card plate s-${j.state}`} draggable={unsent} onDragStart={(e) => e.dataTransfer.setData("application/x-meshy-card", j.key)}>
      <div className="pics">
        <img src={imageUrl(j.key, j.updatedAt)} alt="" loading="lazy" />
        {j.thumbnail && <img src={j.thumbnail} alt="" title="Meshy preview" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </div>
      <div className="body">
        <div className="title">
          {editable
            ? <input className="name" defaultValue={j.outName} aria-label="Output name" onBlur={(e) => e.target.value !== j.outName && run(api.edit(j.key, { outName: e.target.value }))} />
            : <strong>{j.outName}</strong>}
          <span className="ext">.glb</span>
        </div>
        <p className="muted small file">{showFolder && j.folder ? `${j.folder}/` : ""}{j.file}</p>

        <div className="fields">
          <select value={j.prefix} disabled={!unsent} aria-label="Preset" onChange={(e) => run(api.edit(j.key, { prefix: e.target.value }))}>
            {sum.presets.map((p) => <option key={p.prefix} value={p.prefix}>{p.label}</option>)}
          </select>
          <span className="size">
            <select value={sizeKind} disabled={!editable} aria-label="Size by" onChange={(e) => setSize(e.target.value, sizeVal)}>
              <option value="height">Height</option><option value="longest">Longest</option>
              {(unsent || sizeKind === "auto") && <option value="auto">Meshy's guess</option>}
            </select>
            {sizeKind !== "auto" && <>
              <input type="number" min="0.01" step="0.1" defaultValue={sizeVal} key={sizeVal} disabled={!editable} aria-label="Meters"
                onBlur={(e) => Number(e.target.value) !== sizeVal && setSize(sizeKind, Number(e.target.value))} />
              <span className="muted">m</span>
            </>}
          </span>
          <select value={j.origin} disabled={!editable} aria-label="Origin" onChange={(e) => run(api.edit(j.key, { origin: e.target.value as Card["origin"] }))}>
            <option value="bottom">Origin bottom</option><option value="center">Origin center</option>
          </select>
        </div>

        {unsent && (
          <label className="check small" title="Shape only now; texture just the keepers later (Retexture)">
            <input type="checkbox" checked={!!j.draft} onChange={(e) => run(api.edit(j.key, { draft: e.target.checked }))} />
            Draft, no texture yet: ~{j.draftEstimate} now, ~{j.textureEstimate} to texture later
          </label>
        )}

        <div className="status">
          <span className={`badge b-${texturing ? "running" : j.state}`}>
            {texturing ? (tex!.state === "queued" ? "Texture queued" : "Texturing") : STATE_TEXT[j.state]}
            {(j.state === "running" && j.meshyStatus === "PENDING") || (tex?.state === "running" && tex.meshyStatus === "PENDING") ? " · waiting" : ""}
          </span>
          {j.state === "done" && !j.textured && !texturing && <span className="tag dim">Untextured</span>}
          <span className="small credits">{(j.credits ?? 0) + (tex?.credits ?? 0) ? `${(j.credits ?? 0) + (tex?.credits ?? 0)} cr` : `~${j.estimate} cr`}</span>
          {j.state === "new" && <button className="ghost small" onClick={onSend}>Send</button>}
          {(j.state === "queued" || (j.state === "running" && j.meshyStatus === "PENDING") || tex?.state === "queued" || (tex?.state === "running" && tex.meshyStatus === "PENDING")) &&
            <button className="ghost small" onClick={() => run(api.cancel(j.key))}>Cancel</button>}
          {failed && <button className="ghost small" onClick={onRetry}>Retry</button>}
          {canTexture && tex?.state !== "failed" && <button className="ghost small" onClick={onTexture}>Texture · ~{j.textureEstimate}</button>}
          {j.state === "done" && !texturing && onBlender && <button className="ghost small" onClick={onBlender}>Blender</button>}
        </div>
        {j.state === "running" && <progress max={100} value={j.progress} aria-label="Meshy progress" />}
        {tex?.state === "running" && <progress max={100} value={tex.progress} aria-label="Texture progress" />}
        {j.error && <p className="error small">{j.error}</p>}
        {tex?.error && <p className="error small">Texture: {tex.error}</p>}
        {j.state === "done" && <p className="ok small">002_ready/{j.ready}</p>}
        {j.prefix === "" && unsent && <p className="warn small">No known prefix; using Default.</p>}
      </div>
    </li>
  );
}
