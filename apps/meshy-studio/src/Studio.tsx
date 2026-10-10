// The workspace: organizing folders on the left; the cards as a folder grid or a pipeline board.
// Drop images or .prompt.txt files anywhere to add them to the open folder; drag a card onto a
// folder to move it. Tick cards to change many at once. Every spend goes through the cost
// confirmation (unless turned off in Settings) and the host's spend guards.
import { useEffect, useMemo, useState } from "react";
import { MODEL_CHOICES, TEXTURE_MODELS, type ModelId, type TextureModel } from "../engine/presets.ts";
import { api, imageUrl, type Card, type EditPatch, type Op, type Status, type Summary } from "./api.ts";
import { Board } from "./Board.tsx";
import { ConfirmSend, costOf, type SendAsk } from "./Confirm.tsx";
import { CreateDialog } from "./CreateDialog.tsx";
import { OptionFields } from "./OptionFields.tsx";
import { PresetsPanel } from "./Presets.tsx";
import { SettingsPanel } from "./Settings.tsx";
import { StepDialog } from "./StepDialog.tsx";

const ALL = "\u0000all";
const folderLabel = (f: string) => f === "" ? "Top folder" : f;
const FINDER = navigator.platform.startsWith("Mac") ? "Finder" : "files";
const modelLabel = (id: ModelId) => MODEL_CHOICES.find((m) => m.id === id)!.label;
const unsent = (c: Card) => c.state === "new" || (c.state === "failed" && !c.taskId);

type View = "folders" | "pipeline";
const savedView = (): View => { try { return localStorage.getItem("meshy-view") === "pipeline" ? "pipeline" : "folders"; } catch { return "folders"; } };

/** A card's overrides patch from the option editor: values and null set, undefined goes back to the preset. */
const toEdit = (patch: Record<string, unknown>): EditPatch => {
  const overrides: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const [k, v] of Object.entries(patch)) (v === undefined ? clear.push(k) : (overrides[k] = v));
  return { ...(Object.keys(overrides).length ? { overrides } : {}), ...(clear.length ? { clear: clear as EditPatch["clear"] } : {}) };
};

export function Studio({ status, onLeave, onStatus }: { status: Status; onLeave: () => void; onStatus: () => void }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [folder, setFolder] = useState<string>(ALL);
  const [view, setViewState] = useState<View>(savedView);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [ask, setAsk] = useState<SendAsk | null>(null);
  const [panel, setPanel] = useState<"settings" | "presets" | null>(null);
  const [steps, setSteps] = useState<Card[] | null>(null);
  const [create, setCreate] = useState<{ refs: Card[]; tab?: "text-to-3d" | "text-to-image" | "image-to-image" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("meshy-view", v); } catch {} };
  const run = (p: Promise<Summary & { skipped?: string[] }>) => p.then((s) => {
    setSum(s); setError(null);
    if (s.skipped?.length) setNote(`Skipped: ${s.skipped.join("; ")}`);
  }, (e) => setError(e.message));
  const refreshBalance = () => api.balance().then((b) => setBalance(b.balance), () => setBalance(null));
  useEffect(() => {
    run(api.jobs());
    const t = setInterval(() => api.jobs().then(setSum, () => {}), 1500);
    return () => clearInterval(t);
  }, []);
  // Credits move as tasks start and finish: refresh when something changes state, not on every poll.
  const states = sum ? [...sum.jobs.map((j) => j.state + (j.ops ?? []).map((o) => o.state).join()), ...sum.concepts.map((c) => c.state)].join() : "";
  useEffect(() => { refreshBalance(); }, [states, status.hasKey]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 6000); return () => clearTimeout(t); }, [note]);
  // Forget selections of cards that went away.
  useEffect(() => { if (sum) setSelected((s) => new Set([...s].filter((k) => sum.jobs.some((j) => j.key === k)))); }, [sum?.version]);

  const shown = useMemo(() => sum?.jobs.filter((j) => folder === ALL || j.folder === folder) ?? [], [sum, folder]);
  if (!sum) return error ? <p className="fatal">{error}</p> : null;

  const fresh = shown.filter((j) => j.state === "new");
  const cost = fresh.reduce((n, j) => n + (j.draft ? j.draftEstimate : j.estimate), 0);
  const active = sum.jobs.filter((j) => j.state === "queued" || j.state === "running" || (j.ops ?? []).some((o) => o.state === "queued" || o.state === "running")).length;
  const target = folder === ALL ? "" : folder;
  const low = balance !== null && cost > 0 && cost > balance;
  const drafts = shown.filter((j) => j.canTexture);
  const picked = sum.jobs.filter((j) => selected.has(j.key));
  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Spending goes through here: confirm first unless the person turned that off.
  const spend = (a: SendAsk) => {
    if (status.settings.confirmSends) setAsk(a);
    else {
      const credits = a.kind === "spend" ? a.rows.reduce((n, r) => n + r.n * r.each, 0) : a.cards.reduce((n, c) => n + costOf(c, a.kind), 0);
      doSend(a, credits, false);
    }
  };
  const requestSend = (cards: Card[], kind: "shape" | "texture" | "retry" = "shape") => { if (cards.length) spend({ kind, cards }); };
  const doSend = async (a: SendAsk, credits: number, draft: boolean) => {
    setAsk(null);
    if (a.kind === "spend") { await run(a.run(credits) as Promise<Summary>); return; }
    const keys = a.cards.map((c) => c.key);
    if (a.kind === "retry") for (const c of a.cards) await run(api.retry(c.key, costOf(c, "retry")));
    else if (a.kind === "texture") await run(api.texture(keys, credits));
    else await run(api.send(keys, credits, draft));
  };
  // A failed scale re-runs for free; a failed task costs credits again.
  const retry = (cards: Card[]) => {
    const free = cards.filter((c) => costOf(c, "retry") === 0);
    for (const c of free) run(api.retry(c.key, 0));
    requestSend(cards.filter((c) => !free.includes(c)), "retry");
  };
  const texture = (cards: Card[]) => requestSend(cards.filter((c) => c.canTexture), "texture");
  const blender = status.blender ? (cards: Card[]) => api.blender(cards.map((c) => c.key)).then(
    (r) => setNote(`Opening ${r.opened} model${r.opened === 1 ? "" : "s"} in Blender…`), (e) => setError(e.message)) : undefined;

  const upload = async (files: FileList | File[], into = target) => {
    const ok = [...files].filter((f) => /\.(png|jpe?g)$/i.test(f.name) || /\.prompt\.txt$/i.test(f.name));
    if (!ok.length) { setError("Drop .png or .jpg images, or .prompt.txt prompts."); return; }
    for (const f of ok) await run(api.upload(into, f));
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
        <button className="ghost" onClick={() => setCreate({ refs: [] })}>Create</button>
        <button className="ghost" onClick={() => setPanel("presets")}>Presets</button>
        <button className="ghost" onClick={() => setPanel("settings")}>⚙ Settings</button>
      </header>

      <aside className="side">
        <h3>Folders</h3>
        <nav aria-label="Folders">
          <FolderRow label="All cards" count={sum.jobs.length} active={folder === ALL} onClick={() => setFolder(ALL)} />
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

        {sum.concepts.length > 0 && <>
          <h3>Concept images</h3>
          <ul className="concepts">
            {sum.concepts.slice(-8).reverse().map((c) => (
              <li key={c.id} className={`c-${c.state}`}>
                <span className="grow"><strong>{c.name}</strong><span className="muted small">{c.params.ai_model} · {c.state === "running" ? `${c.progress}%` : c.state} · {c.credits ?? `~${c.estimate}`} cr</span></span>
                {c.error && <span className="error small">{c.error}</span>}
                <button className="ghost small" title={c.state === "done" || c.state === "failed" ? "Dismiss" : "Cancel"} onClick={() => run(api.cancelConcept(c.id))}>✕</button>
              </li>
            ))}
          </ul>
        </>}

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
          : <button className="link small" onClick={() => setPanel("settings")}>Connect Unity, Unreal or Blender…</button>}</p>
      </aside>

      <main className="main">
        <header className="bar">
          <div>
            <h1>{folder === ALL ? "All cards" : folderLabel(folder)}</h1>
            <p className="muted small">{shown.length} card{shown.length === 1 ? "" : "s"}{active ? ` · ${active} with Meshy` : ""}
              {shown.length > 0 && <> · <button className="link small" onClick={() => setSelected(new Set(shown.every((j) => selected.has(j.key)) ? [] : shown.map((j) => j.key)))}>{shown.every((j) => selected.has(j.key)) ? "select none" : "select all"}</button></>}</p>
          </div>
          <label className="button ghost">
            Add files…
            <input type="file" accept=".png,.jpg,.jpeg,.txt" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
          {drafts.length > 0 && <button className="ghost" onClick={() => texture(drafts)}>Texture {drafts.length} draft{drafts.length === 1 ? "" : "s"} · ~{drafts.reduce((n, c) => n + c.textureEstimate, 0)}</button>}
          <button className="primary" disabled={!fresh.length} onClick={() => requestSend(fresh)}>
            {fresh.length ? `Send ${fresh.length} · ~${cost} credits` : "Nothing new to send"}
          </button>
        </header>

        {picked.length > 0 && <BulkBar cards={picked} sum={sum} run={run} onClear={() => setSelected(new Set())}
          onSend={() => requestSend(picked.filter((c) => c.state === "new"))} onTexture={() => texture(picked)}
          onSteps={() => setSteps(picked.filter((c) => c.state === "done"))} onVary={() => setCreate({ refs: picked, tab: "image-to-image" })}
          onCombine={() => run(api.combine(picked.map((c) => c.key))).then(() => setSelected(new Set()))} />}

        {sum.pause && <p className="banner" role="alert">{sum.pause.reason}{!sum.pause.until && <button className="ghost small" onClick={() => run(api.resume())}>Resume</button>}</p>}
        {error && <p className="banner" role="alert">{error}<button className="ghost small" onClick={() => setError(null)}>Dismiss</button></p>}
        {low && <p className="banner">These {fresh.length} need about {cost} credits; the account has {balance}.</p>}

        {shown.length === 0 ? (
          <div className={`empty plate ${dropping ? "over" : ""}`}>
            <p><strong>Drop .png or .jpg images here</strong>, or put them in <code>000_to_be_meshyd/{target}</code> in {FINDER}. Or press <strong>Create</strong> for Text to 3D and concept images.</p>
            <p className="muted">The filename is the label: <code>flora_oak_h12_bottom.png</code> uses the Flora preset, scales to 12 m tall, origin at the bottom, and comes out as <code>flora_oak.glb</code>. Views of one object (<code>oak__front.png</code>, <code>oak__back.png</code>) become one multi-image card; <code>oak.prompt.txt</code> becomes a Text to 3D card.</p>
          </div>
        ) : view === "pipeline" ? (
          <Board cards={shown} act={{ send: (c) => requestSend(c), texture, retry, cancel: (c) => run(api.cancel(c.key)), blender, say: setNote, selected, toggle }} />
        ) : (
          <ul className={`cards ${dropping ? "over" : ""}`}>
            {shown.map((j) => <CardView key={j.key} j={j} sum={sum} run={run} showFolder={folder === ALL} selected={selected.has(j.key)} onToggle={() => toggle(j.key)}
              onSend={() => requestSend([j])} onRetry={() => retry([j])} onTexture={() => texture([j])} onSteps={() => setSteps([j])}
              onVary={() => setCreate({ refs: [j], tab: "image-to-image" })} onBlender={blender && (() => blender([j]))} />)}
          </ul>
        )}
      </main>

      {note && <p className="toast" role="status">{note}</p>}
      {ask && <ConfirmSend ask={ask} balance={balance} batchCap={status.settings.batchCap} onCancel={() => setAsk(null)} onConfirm={(n, d) => doSend(ask, n, d)} />}
      {steps && <StepDialog cards={steps} presets={sum.presets} onClose={() => setSteps(null)} onAsk={(a) => { setSteps(null); spend(a); }} />}
      {create && <CreateDialog sum={sum} folder={target} references={create.refs} initial={create.tab} onClose={() => setCreate(null)} onSummary={setSum}
        onAsk={(a) => { setCreate(null); spend(a); }} />}
      {panel === "presets" && <PresetsPanel sum={sum} onClose={() => setPanel(null)} onSaved={setSum} />}
      {panel === "settings" && <SettingsPanel status={status} sum={sum} balance={balance} onClose={() => setPanel(null)}
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

/** Change many cards at once: one model for all, drafts, send, texture, steps, combine, vary. */
function BulkBar({ cards, sum, run, onClear, onSend, onTexture, onSteps, onVary, onCombine }: {
  cards: Card[]; sum: Summary; run: (p: Promise<Summary & { skipped?: string[] }>) => void; onClear: () => void;
  onSend: () => void; onTexture: () => void; onSteps: () => void; onVary: () => void; onCombine: () => void;
}) {
  const open = cards.filter(unsent);
  const ids = [...new Set(open.flatMap((c) => Object.keys(c.modelCosts ?? {}) as ModelId[]))];
  const allDraft = open.length > 0 && open.every((c) => c.draft);
  const priceFor = (id: ModelId) => open.reduce((n, c) => n + (c.modelCosts?.[id] ? (c.draft ? c.modelCosts[id].draft : c.modelCosts[id].full) : 0), 0);
  const fitFor = (id: ModelId) => open.filter((c) => c.modelCosts?.[id] && !c.modelCosts[id].problems.length).length;
  const canCombine = cards.length >= 2 && cards.length <= 4 && cards.every((c) => c.source === "image" && unsent(c)) && new Set(cards.map((c) => c.folder)).size === 1;
  const newOnes = cards.filter((c) => c.state === "new");
  const done = cards.filter((c) => c.state === "done");
  const drafts = cards.filter((c) => c.canTexture);
  return (
    <div className="bulk plate" role="region" aria-label="Selected cards">
      <strong>{cards.length} selected</strong>
      {open.length > 0 && <>
        <label className="row">Model for {open.length === cards.length ? "all" : `the ${open.length} unsent`}
          <select value="" onChange={(e) => e.target.value && run(api.editMany(open.map((c) => c.key), { model: e.target.value as ModelId | "preset" }))}>
            <option value="">choose…</option>
            <option value="preset">Each card's preset</option>
            {ids.map((id) => <option key={id} value={id}>{modelLabel(id)} · ~{priceFor(id)} cr total{fitFor(id) < open.length ? ` (${fitFor(id)} of ${open.length} cards can use it)` : ""}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={allDraft} onChange={(e) => run(api.editMany(open.map((c) => c.key), { draft: e.target.checked }))} />Generate only (texture later)</label>
        <label className="row">Preset
          <select value={"\u0000"} onChange={(e) => e.target.value !== "\u0000" && run(api.editMany(open.map((c) => c.key), { prefix: e.target.value }))}>
            <option value={"\u0000"}>choose…</option>
            {sum.presets.map((p) => <option key={p.prefix} value={p.prefix}>{p.label}</option>)}
          </select>
        </label>
      </>}
      <span className="grow" />
      {newOnes.length > 0 && <button className="primary small" onClick={onSend}>Send {newOnes.length}</button>}
      {drafts.length > 0 && <button className="ghost small" onClick={onTexture}>Texture {drafts.length}</button>}
      {done.length > 0 && <button className="ghost small" onClick={onSteps}>Steps on {done.length}…</button>}
      {canCombine && <button className="ghost small" onClick={onCombine} title="Send these as views of one object (Multi-Image to 3D)">Combine as one model</button>}
      {cards.some((c) => c.source !== "text") && <button className="ghost small" onClick={onVary} title="Image to Image from these pictures">Vary…</button>}
      <button className="ghost small" onClick={onClear}>Clear</button>
    </div>
  );
}

const STATE_TEXT: Record<Card["state"], string> = { new: "New", queued: "Queued", running: "With Meshy", downloaded: "Scaling", done: "Ready", failed: "Failed" };
const SOURCE_TEXT: Record<Card["source"], string> = { image: "Image", multi: "Multi-image", text: "Text to 3D" };

function CardView({ j, sum, run, showFolder, selected, onToggle, onSend, onRetry, onTexture, onSteps, onVary, onBlender }: {
  j: Card; sum: Summary; run: (p: Promise<Summary>) => void; showFolder: boolean; selected: boolean; onToggle: () => void;
  onSend: () => void; onRetry: () => void; onTexture: () => void; onSteps: () => void; onVary: () => void; onBlender?: () => void;
}) {
  const [more, setMore] = useState(false);
  const open = unsent(j);
  const editable = open || !!j.raw;
  const sizeKind = "height" in j.size ? "height" : "longest" in j.size ? "longest" : "auto";
  const sizeVal = "height" in j.size ? j.size.height : "longest" in j.size ? j.size.longest : 1;
  const setSize = (kind: string, v: number) => (kind === "auto" || v > 0) &&
    run(api.edit(j.key, { size: kind === "auto" ? { auto: true } : kind === "height" ? { height: v } : { longest: v } }));
  const ops = j.ops ?? [];
  const pending = ops.find((o) => o.state !== "done");
  const busy = j.state === "queued" || j.state === "running" || pending?.state === "queued" || pending?.state === "running";
  const failed = j.state === "failed" || pending?.state === "failed";
  const cancellable = j.state === "queued" || (j.state === "running" && j.meshyStatus === "PENDING");
  const spent = (j.credits ?? 0) + ops.reduce((n, o) => n + (o.credits ?? 0), 0);
  const preset = sum.presets.find((p) => p.prefix === j.prefix);
  const texturing = !j.draft && j.options.should_texture !== false;
  const setTexturing = (on: boolean) => run(api.edit(j.key, on
    ? { draft: false, ...(j.options.should_texture === false ? { overrides: { should_texture: null } } : {}) }
    : { draft: true }));
  const warnings = j.problems ?? [];
  const nViews = 1 + (j.views?.length ?? 0);

  return (
    <li className={`card plate s-${pending && j.state === "done" ? (pending.state === "failed" ? "failed" : "running") : j.state} ${selected ? "selected" : ""}`}
      draggable={open} onDragStart={(e) => e.dataTransfer.setData("application/x-meshy-card", j.key)}>
      <div className={`pics ${j.source === "text" ? "text" : ""}`}>
        <input type="checkbox" className="pick" checked={selected} onChange={onToggle} aria-label={`Select ${j.outName}`} />
        {j.source === "text"
          ? <blockquote className="prompt">{j.prompt || "(empty prompt)"}</blockquote>
          : <img src={imageUrl(j.key, j.updatedAt)} alt="" loading="lazy" />}
        {j.source === "multi" && <div className="views">{(j.views ?? []).slice(0, 3).map((_, i) => <img key={i} src={imageUrl(j.key, j.updatedAt, i + 1)} alt="" loading="lazy" />)}</div>}
        {j.thumbnail && <img src={j.thumbnail} alt="" title="Meshy preview" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </div>
      <div className="body">
        <div className="title">
          {editable
            ? <input className="name" defaultValue={j.outName} aria-label="Output name" onBlur={(e) => e.target.value !== j.outName && run(api.edit(j.key, { outName: e.target.value }))} />
            : <strong>{j.outName}</strong>}
          <span className="ext">.glb</span>
        </div>
        <p className="muted small file"><span className={`src src-${j.source}`}>{SOURCE_TEXT[j.source]}{j.source === "multi" ? ` ×${nViews}` : ""}</span> {showFolder && j.folder ? `${j.folder}/` : ""}{j.file}</p>

        {j.source === "text" && open && (
          <textarea className="prompt-edit" rows={2} maxLength={800} defaultValue={j.prompt} aria-label="Text to 3D prompt"
            onBlur={(e) => e.target.value.trim() !== j.prompt && run(api.setPrompt(j.key, e.target.value))} />
        )}

        {open && (
          <label className="toggle" title="Generate only: the shape now, texture just the keepers later">
            <input type="checkbox" role="switch" checked={texturing} onChange={(e) => setTexturing(e.target.checked)} />
            <span className="toggle-text">{texturing ? <>Generate and<br />texture</> : "Generate"}</span>
          </label>
        )}

        <div className="fields">
          <span className="size">
            <select value={sizeKind} disabled={!editable} aria-label="Size by" onChange={(e) => setSize(e.target.value, sizeVal)}>
              <option value="height">Height</option><option value="longest">Longest</option>
              {(open || sizeKind === "auto") && <option value="auto">Meshy's guess</option>}
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
          {open && j.modelCosts ? (
            <label className="picker"><span>Generate</span>
              <select value={j.model} onChange={(e) => run(api.edit(j.key, { model: e.target.value as ModelId }))}>
                {(Object.keys(j.modelCosts) as ModelId[]).map((id) => {
                  const c = j.modelCosts![id];
                  return <option key={id} value={id} disabled={c.problems.length > 0} title={c.problems[0]}>{modelLabel(id)} · {c.draft} cr{c.problems.length ? " ⚠" : ""}</option>;
                })}
              </select>
            </label>
          ) : <span className="tag dim">{modelLabel(j.model)}</span>}
          {open && texturing && j.textureCosts && (
            <label className="picker"><span>Texture</span>
              <select value={j.textureModel ?? "same"} onChange={(e) => run(api.edit(j.key, { textureModel: e.target.value === "same" ? null : e.target.value as TextureModel }))}>
                <option value="same">{j.source === "text" ? "Preset's model" : "Same as generate"} · +{j.textureCosts.same} cr</option>
                {TEXTURE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · +{j.textureCosts![m.id]} cr</option>)}
              </select>
            </label>
          )}
        </div>

        {open && <button className="link small" onClick={() => setMore(!more)}>{more ? "Hide settings" : `All settings${j.overrides ? ` (${Object.keys(j.overrides).length} set on this card)` : ""}`}</button>}
        {open && more && preset && (
          <div className="card-options">
            <label className="picker"><span>Preset</span>
              <select value={j.prefix} aria-label="Preset" onChange={(e) => run(api.edit(j.key, { prefix: e.target.value }))}>
                {sum.presets.map((p) => <option key={p.prefix} value={p.prefix}>{p.label}{p.prefix ? ` (${p.prefix}…)` : ""}</option>)}
              </select>
            </label>
            <OptionFields source={j.source} base={preset.options} value={j.overrides ?? {}} onSet={(patch) => run(api.edit(j.key, toEdit(patch)))} />
            {j.overrides && <button className="ghost small" onClick={() => run(api.edit(j.key, { clear: Object.keys(j.overrides!) as EditPatch["clear"] }))}>Reset to the preset</button>}
          </div>
        )}
        {open && warnings.map((m) => <p key={m} className="warn small">{m}</p>)}

        <div className="status">
          <span className={`badge b-${busy ? "running" : failed ? "failed" : j.state}`}>
            {pending && j.state === "done" ? `${pending.label}: ${pending.state === "queued" ? "queued" : pending.state === "failed" ? "failed" : pending.meshyStatus === "PENDING" ? "waiting" : `${pending.progress}%`}` : STATE_TEXT[j.state]}
            {j.state === "running" && j.meshyStatus === "PENDING" ? " · waiting" : ""}
          </span>
          {j.canTexture && <span className="tag dim">Untextured</span>}
          <span className="small credits">{spent ? `${spent} cr` : `~${j.draft ? j.draftEstimate : j.estimate} cr`}</span>
          {j.state === "new" && <button className="ghost small" onClick={onSend}>Send</button>}
          {cancellable && <button className="ghost small" onClick={() => run(api.cancel(j.key))}>Cancel</button>}
          {failed && <button className="ghost small" onClick={onRetry}>Retry</button>}
          {j.canTexture && <button className="ghost small" onClick={onTexture}>Texture · ~{j.textureEstimate}</button>}
          {j.state === "done" && <button className="ghost small" onClick={onSteps}>Steps…</button>}
          {j.source !== "text" && <button className="ghost small" onClick={onVary} title="Image to Image: new versions of this picture">Vary…</button>}
          {j.source === "multi" && open && j.where === "inbox" && <button className="ghost small" onClick={() => run(api.split(j.key))}>Split views</button>}
          {j.state === "done" && !busy && onBlender && <button className="ghost small" onClick={onBlender}>Blender</button>}
        </div>
        {j.state === "running" && <progress max={100} value={j.progress} aria-label="Meshy progress" />}
        {j.error && <p className="error small">{j.error}</p>}
        {ops.length > 0 && <ol className="ops">{ops.map((o) => <OpRow key={o.id} o={o} j={j} run={run} />)}</ol>}
        {j.state === "done" && <p className="ok small">002_ready/{j.ready}{j.readyExtras?.length ? ` +${j.readyExtras.length}` : ""}{j.extras?.length ? ` · ${j.extras.length} more in 001` : ""}</p>}
      </div>
    </li>
  );
}

function OpRow({ o, j, run }: { o: Op; j: Card; run: (p: Promise<Summary>) => void }) {
  const waiting = o.state === "queued" || (o.state === "running" && o.meshyStatus === "PENDING");
  return (
    <li className={`op op-${o.state}`}>
      <span className="grow">{o.label}</span>
      <span className="muted small">{o.state === "running" ? (o.meshyStatus === "PENDING" ? "waiting" : `${o.progress}%`) : o.state}</span>
      <span className="small credits">{o.credits ?? `~${o.estimate}`}</span>
      {waiting && <button className="ghost small" title="Cancel this step (and the ones after it)" onClick={() => run(api.cancelOp(j.key, o.id))}>✕</button>}
      {(o.state === "done" || o.state === "failed") && <button className="ghost small" title="Remove from the list (files stay)" onClick={() => run(api.dropOp(j.key, o.id))}>✕</button>}
      {o.state === "running" && <progress max={100} value={o.progress} aria-label={`${o.label} progress`} />}
      {o.error && <span className="error small">{o.error}</span>}
    </li>
  );
}
