// The pipeline as a board: Inbox → Queue → With Meshy → Ready, plus Failed.
// Drag Inbox → Queue to send (cost confirmed first), Queue → Inbox to pull it back,
// Failed → Queue to retry.
import { useState } from "react";
import { imageUrl, type Card } from "./api.ts";

type Col = "new" | "queued" | "meshy" | "ready" | "failed";
const COLS: { id: Col; title: string; empty: string }[] = [
  { id: "new", title: "Inbox", empty: "Drop images on the window" },
  { id: "queued", title: "Queue", empty: "Drag cards here to send" },
  { id: "meshy", title: "With Meshy", empty: "Nothing generating" },
  { id: "ready", title: "Ready", empty: "Finished models land here" },
  { id: "failed", title: "Failed", empty: "Nothing failed" },
];
const colOf = (c: Card): Col =>
  c.state === "new" ? "new" : c.state === "queued" ? "queued" : c.state === "done" ? "ready" : c.state === "failed" ? "failed" : "meshy";

export interface BoardActions {
  send: (cards: Card[]) => void;
  retry: (cards: Card[]) => void;
  cancel: (card: Card) => void;
  blender?: (cards: Card[]) => void;
  say: (msg: string) => void;
}

export function Board({ cards, act }: { cards: Card[]; act: BoardActions }) {
  const [over, setOver] = useState<Col | null>(null);
  const byKey = new Map(cards.map((c) => [c.key, c]));

  const drop = (to: Col, e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const card = byKey.get(e.dataTransfer.getData("application/x-meshy-card"));
    if (!card) return;
    const from = colOf(card);
    if (from === to) return;
    if (to === "queued" && from === "new") act.send([card]);
    else if (to === "queued" && from === "failed") act.retry([card]);
    else if (to === "new" && (from === "queued" || (from === "meshy" && card.meshyStatus === "PENDING"))) act.cancel(card);
    else act.say(from === "meshy" ? "Meshy is already working on that one." : "Cards move Inbox → Queue, back to Inbox, or Failed → Queue.");
  };

  return (
    <div className="board">
      {COLS.map((col) => {
        const list = cards.filter((c) => colOf(c) === col.id);
        return (
          <section key={col.id} className={`lane plate lane-${col.id} ${over === col.id ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(col.id); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => drop(col.id, e)}>
            <header>
              <h3>{col.title}</h3>
              <span className="count">{list.length}</span>
            </header>
            {col.id === "new" && list.length > 0 && <button className="primary small wide" onClick={() => act.send(list)}>Send all · ~{list.reduce((n, c) => n + c.estimate, 0)} cr</button>}
            {col.id === "failed" && list.length > 0 && <button className="ghost small wide" onClick={() => act.retry(list)}>Retry all</button>}
            {col.id === "ready" && list.length > 0 && act.blender && <button className="ghost small wide" onClick={() => act.blender!(list)}>Open all in Blender</button>}
            <ul>
              {list.map((c) => <Chip key={c.key} c={c} />)}
              {!list.length && <li className="muted small empty-lane">{col.empty}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Chip({ c }: { c: Card }) {
  const movable = c.state === "new" || c.state === "queued" || c.state === "failed" || (c.state === "running" && c.meshyStatus === "PENDING");
  return (
    <li className="chip" draggable={movable} onDragStart={(e) => e.dataTransfer.setData("application/x-meshy-card", c.key)} title={c.key}>
      <img src={c.thumbnail ?? imageUrl(c.key, c.updatedAt)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = imageUrl(c.key, c.updatedAt); }} />
      <div>
        <strong>{c.outName}</strong>
        <span className="muted small">{c.folder ? `${c.folder} · ` : ""}{c.presetLabel} · {c.sizeText}</span>
        <span className="small credits">{c.credits ? `${c.credits} cr` : `~${c.estimate} cr`}</span>
        {c.state === "running" && <progress max={100} value={c.progress} aria-label="Meshy progress" />}
        {c.state === "running" && c.meshyStatus === "PENDING" && <span className="small muted">waiting in Meshy's queue</span>}
        {c.state === "downloaded" && <span className="small muted">scaling…</span>}
        {c.error && <span className="small error">{c.error}</span>}
      </div>
    </li>
  );
}
