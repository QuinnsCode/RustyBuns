// Before credits are spent: what goes, what it costs, and what's left after.
// For a shape send, "untextured drafts" re-prices the batch live.
import { useEffect, useState } from "react";
import { scrimProps } from "./scrim.ts";
import type { Card } from "./api.ts";

export interface Row { label: string; n: number; each: number }
export type SendAsk =
  | { kind: "shape" | "texture" | "retry"; cards: Card[] }
  /** Steps and concept images: rows already priced; run() does the spending call. */
  | { kind: "spend"; title: string; rows: Row[]; note?: string; run: (credits: number) => Promise<unknown> };

const pendingOp = (c: Card) => (c.ops ?? []).find((o) => o.state === "failed");

/** What one card costs for this kind of send. */
export const costOf = (c: Card, kind: "shape" | "texture" | "retry", draft = false) =>
  kind === "texture" ? c.textureEstimate
    : kind === "retry" ? (pendingOp(c)?.estimate ?? (c.raw ? 0 : c.estimate))
    : draft || c.draft ? c.draftEstimate : c.estimate;

const SOURCE: Record<Card["source"], string> = { image: "", multi: " · multi-image", text: " · text to 3D" };

function rowsFor(ask: Extract<SendAsk, { cards: Card[] }>, draft: boolean): Row[] {
  const rows = new Map<string, Row>();
  for (const c of ask.cards) {
    const each = costOf(c, ask.kind, draft);
    const op = ask.kind === "retry" ? pendingOp(c) : undefined;
    const label = ask.kind === "texture" ? `Texture · ${c.presetLabel}`
      : op ? `${op.label} again`
      : `${c.presetLabel} · ${c.model}${SOURCE[c.source]}${draft || c.draft ? " · no texture" : ""}`;
    const r = rows.get(label + each) ?? { label, n: 0, each };
    r.n++;
    rows.set(label + each, r);
  }
  return [...rows.values()];
}

export function ConfirmSend({ ask, balance, batchCap, onCancel, onConfirm }: {
  ask: SendAsk; balance: number | null; batchCap: number; onCancel: () => void; onConfirm: (credits: number, draft: boolean) => void;
}) {
  const [draft, setDraft] = useState(false);
  const rows = ask.kind === "spend" ? ask.rows : rowsFor(ask, draft);
  const total = rows.reduce((n, r) => n + r.n * r.each, 0);
  const count = rows.reduce((n, r) => n + r.n, 0);
  const after = balance === null ? null : balance - total;
  const share = balance ? Math.min(1, total / balance) : 0;
  const overCap = batchCap > 0 && total > batchCap;
  const overBalance = after !== null && after < 0;
  const cards = ask.kind === "spend" ? [] : ask.cards;
  const saving = ask.kind === "shape" ? cards.reduce((n, c) => n + (c.draft ? 0 : c.estimate - c.draftEstimate), 0) : 0;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  const title = ask.kind === "spend" ? ask.title
    : `${{ shape: "Send", texture: "Texture", retry: "Run again:" }[ask.kind]} ${count} card${count === 1 ? "" : "s"}${ask.kind === "shape" ? " to Meshy" : ""}?`;

  return (
    <div className="scrim center" {...scrimProps(onCancel)}>
      <div className="modal plate" role="dialog" aria-label="Confirm spend">
        <h2>{title}</h2>

        {ask.kind === "shape" && saving > 0 && (
          <label className="check draft-toggle">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            <span>Untextured drafts: shape only now, <strong>texture later</strong> just the keepers (~10 credits each). Saves {saving} credits on this batch.</span>
          </label>
        )}
        {ask.kind === "texture" && <p className="muted small">Meshy paints the finished shape, styled from the card's text prompt, texture image, or the concept image itself.</p>}
        {ask.kind === "spend" && ask.note && <p className="muted small">{ask.note}</p>}

        <table className="bill">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label + r.each}><td>{r.label}</td><td className="n">{r.n} × {r.each}</td><td className="n">{r.n * r.each}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>Estimated</td><td /><td className="n credits">{total}</td></tr>
          </tfoot>
        </table>

        <div className="meter" aria-label={`${Math.round(share * 100)}% of the balance`}>
          <div className="fill" style={{ width: `${share * 100}%` }} data-hot={share > 0.25 || undefined} />
        </div>
        <p className="small">
          Balance {balance === null ? "unknown" : balance.toLocaleString()} → after about <strong className={overBalance ? "error" : ""}>{after === null ? "?" : after.toLocaleString()}</strong> credits
          {balance ? ` (${Math.round(share * 100)}% of what's left)` : ""}.
        </p>
        {overCap && <p className="error small">Over your {batchCap}-credit batch limit. Send fewer, or raise the limit in Settings.</p>}
        {overBalance && <p className="error small">Not enough credits on the account.</p>}
        <p className="muted small">An estimate from Meshy's price table. Meshy refunds tasks that fail or are cancelled while still waiting.</p>

        <div className="row end">
          <button className="ghost" onClick={onCancel} autoFocus>Not now</button>
          <button className="primary" disabled={overCap || overBalance || total === 0 && ask.kind === "spend"} onClick={() => onConfirm(total, draft)}>Spend about {total} credits</button>
        </div>
      </div>
    </div>
  );
}
