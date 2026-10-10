// The pipeline as a board: Inbox → Queue → With Meshy → Ready, plus Failed.
// Drag Inbox → Queue to send (cost confirmed first), back out of Queue to pull it,
// Failed → Queue to retry, and an untextured draft Ready → Queue to texture it.
// A card's steps (texture, remesh, rig …) run it back through Queue and With Meshy.
import { useState } from "react";
import { imageUrl, type Card } from "./api.ts";

type Col = "new" | "queued" | "meshy" | "ready" | "failed";
const COLS: { id: Col; title: string; empty: string }[] = [
  { id: "new", title: "Inbox", empty: "Drop images or prompts on the window" },
  { id: "queued", title: "Queue", empty: "Drag cards here to send" },
  { id: "meshy", title: "With Meshy", empty: "Nothing generating" },
  { id: "ready", title: "Ready", empty: "Finished models land here" },
  { id: "failed", title: "Failed", empty: "Nothing failed" },
];
/** The step that decides where a finished card sits: the first one not done. */
const current = (c: Card) => (c.ops ?? []).find((o) => o.state !== "done");
const colOf = (c: Card): Col => {
  const o = c.state === "done" ? current(c) : undefined;
  if (o) return o.state === "queued" ? "queued" : o.state === "running" ? "meshy" : "failed";
  return c.state === "new" ? "new" : c.state === "queued" ? "queued" : c.state === "done" ? "ready" : c.state === "failed" ? "failed" : "meshy";
};

export interface BoardActions {
  send: (cards: Card[]) => void;
  texture: (cards: Card[]) => void;
  retry: (cards: Card[]) => void;
  cancel: (card: Card) => void;
  blender?: (cards: Card[]) => void;
  say: (msg: string) => void;
  selected: Set<string>;
  toggle: (key: string) => void;
}

export function Board({ cards, act }: { cards: Card[]; act: BoardActions }) {
  const [over, setOver] = useState<Col | null>(null);
  const byKey = new Map(cards.map((c) => [c.key, c]));

  const drop = (to: Col, e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const card = byKey.get(e.dataTransfer.getData("application/x-meshy-card"));
    if (!card) return;
    const from = colOf(card);
    const op = current(card);
    if (from === to) return;
    if (to === "queued" && from === "new") act.send([card]);
    else if (to === "queued" && from === "failed") act.retry([card]);
    else if (to === "queued" && from === "ready" && card.canTexture) act.texture([card]);
    else if ((to === "new" || to === "ready") && (from === "queued" || (from === "meshy" && (op ? op.meshyStatus : card.meshyStatus) === "PENDING"))) act.cancel(card);
    else act.say(from === "meshy" ? "Meshy is already working on that one."
      : from === "ready" ? "That model already has its texture. Add other steps from the card's Steps menu." : "Cards move Inbox → Queue, back out of Queue, Failed → Queue, or an untextured Ready → Queue.");
  };

  return (
    <div className="board">
      {COLS.map((col) => {
        const list = cards.filter((c) => colOf(c) === col.id);
        const drafts = list.filter((c) => c.canTexture);
        return (
          <section key={col.id} className={`lane plate lane-${col.id} ${over === col.id ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(col.id); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => drop(col.id, e)}>
            <header>
              <h3>{col.title}</h3>
              <span className="count">{list.length}</span>
            </header>
            {col.id === "new" && list.length > 0 && <button className="primary small wide" onClick={() => act.send(list)}>Send all · ~{list.reduce((n, c) => n + (c.draft ? c.draftEstimate : c.estimate), 0)} cr</button>}
            {col.id === "failed" && list.length > 0 && <button className="ghost small wide" onClick={() => act.retry(list)}>Retry all</button>}
            {col.id === "ready" && drafts.length > 0 && <button className="ghost small wide" onClick={() => act.texture(drafts)}>Texture {drafts.length} draft{drafts.length === 1 ? "" : "s"} · ~{drafts.reduce((n, c) => n + c.textureEstimate, 0)} cr</button>}
            {col.id === "ready" && list.length > 0 && act.blender && <button className="ghost small wide" onClick={() => act.blender!(list)}>Open all in Blender</button>}
            <ul>
              {list.map((c) => <Chip key={c.key} c={c} selected={act.selected.has(c.key)} onToggle={() => act.toggle(c.key)} />)}
              {!list.length && <li className="muted small empty-lane">{col.empty}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Chip({ c, selected, onToggle }: { c: Card; selected: boolean; onToggle: () => void }) {
  const o = c.state === "done" ? current(c) : undefined;
  const movable = c.state === "new" || c.state === "queued" || c.state === "failed" || (c.state === "running" && c.meshyStatus === "PENDING")
    || c.canTexture || o?.state === "queued" || o?.state === "failed" || (o?.state === "running" && o.meshyStatus === "PENDING");
  const spent = (c.credits ?? 0) + (c.ops ?? []).reduce((n, x) => n + (x.credits ?? 0), 0);
  const img = c.thumbnail ?? (c.source === "text" ? undefined : imageUrl(c.key, c.updatedAt));
  return (
    <li className={`chip ${selected ? "selected" : ""}`} draggable={movable} onDragStart={(e) => e.dataTransfer.setData("application/x-meshy-card", c.key)} title={c.key}>
      <div className="thumb">
        {img ? <img src={img} alt="" loading="lazy" onError={(e) => { if (c.source !== "text") e.currentTarget.src = imageUrl(c.key, c.updatedAt); else e.currentTarget.hidden = true; }} />
          : <span className="src-text" aria-hidden>Aa</span>}
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${c.outName}`} />
      </div>
      <div>
        <strong>{c.outName}</strong>
        <span className="muted small">{c.folder ? `${c.folder} · ` : ""}{c.model} · {c.sizeText}{c.source === "multi" ? ` · ${1 + (c.views?.length ?? 0)} views` : c.source === "text" ? " · text" : ""}</span>
        <span className="small credits">{spent ? `${spent} cr` : `~${c.draft ? c.draftEstimate : c.estimate} cr${c.draft && c.state === "new" ? " · draft" : ""}`}</span>
        {c.canTexture && <span className="small muted">untextured · drag to Queue to texture</span>}
        {o && <span className="small muted">{o.label}: {o.state === "queued" ? "queued" : o.state === "failed" ? "failed" : o.meshyStatus === "PENDING" ? "waiting" : `${o.progress}%`}</span>}
        {o?.state === "running" && <progress max={100} value={o.progress} aria-label={`${o.label} progress`} />}
        {o?.error && <span className="small error">{o.label}: {o.error}</span>}
        {c.state === "running" && <progress max={100} value={c.progress} aria-label="Meshy progress" />}
        {c.state === "running" && c.meshyStatus === "PENDING" && <span className="small muted">waiting in Meshy's queue</span>}
        {c.state === "downloaded" && <span className="small muted">scaling…</span>}
        {c.error && <span className="small error">{c.error}</span>}
      </div>
    </li>
  );
}
