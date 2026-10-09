// Before credits are spent: what goes, what it costs, and what's left after.
// For a shape send, "untextured drafts" re-prices the batch live (5 credits on meshy-6-lite).
import { useEffect, useState } from "react";
import type { Card } from "./api.ts";

export type SendKind = "shape" | "texture" | "retry";
export interface SendAsk { kind: SendKind; cards: Card[] }

/** What one card costs for this kind of send. */
export const costOf = (c: Card, kind: SendKind, draft = false) =>
  kind === "texture" || (kind === "retry" && c.texture?.state === "failed") ? c.textureEstimate
    : kind === "retry" && c.raw ? 0
    : draft || c.draft ? c.draftEstimate : c.estimate;

const TITLES: Record<SendKind, string> = { shape: "Send", texture: "Texture", retry: "Send again:" };

export function ConfirmSend({ ask, balance, batchCap, onCancel, onConfirm }: {
  ask: SendAsk; balance: number | null; batchCap: number; onCancel: () => void; onConfirm: (credits: number, draft: boolean) => void;
}) {
  const [draft, setDraft] = useState(false);
  const total = ask.cards.reduce((n, c) => n + costOf(c, ask.kind, draft), 0);
  const rows = new Map<string, { label: string; n: number; each: number }>();
  for (const c of ask.cards) {
    const each = costOf(c, ask.kind, draft);
    const label = ask.kind === "texture" || (ask.kind === "retry" && c.texture?.state === "failed") ? `Texture · ${c.presetLabel}`
      : `${c.presetLabel}${draft || c.draft ? " · no texture" : ""}`;
    const r = rows.get(label + each) ?? { label, n: 0, each };
    r.n++;
    rows.set(label + each, r);
  }
  const after = balance === null ? null : balance - total;
  const share = balance ? Math.min(1, total / balance) : 0;
  const overCap = batchCap > 0 && total > batchCap;
  const overBalance = after !== null && after < 0;
  const textured = ask.cards.filter((c) => !c.draft).length;
  const saving = ask.kind === "shape" ? ask.cards.reduce((n, c) => n + c.estimate - c.draftEstimate, 0) : 0;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  return (
    <div className="scrim center" onClick={onCancel}>
      <div className="modal plate" role="dialog" aria-label="Confirm spend" onClick={(e) => e.stopPropagation()}>
        <h2>{TITLES[ask.kind]} {ask.cards.length} model{ask.cards.length === 1 ? "" : "s"}{ask.kind === "shape" ? " to Meshy" : ""}?</h2>

        {ask.kind === "shape" && textured > 0 && saving > 0 && (
          <label className="check draft-toggle">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            <span>Untextured drafts: shape only now, <strong>texture later</strong> just the keepers (Retexture, ~10 credits each). Saves {saving} credits on this batch.</span>
          </label>
        )}
        {ask.kind === "texture" && <p className="muted small">Meshy paints the finished shape, styled from the card's text prompt, texture image, or the concept image itself. The UVs it already has are kept.</p>}

        <table className="bill">
          <tbody>
            {[...rows.values()].map((r) => (
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
        <p className="muted small">An estimate from Meshy's price table. Meshy refunds jobs that fail or are cancelled while still waiting.</p>

        <div className="row end">
          <button className="ghost" onClick={onCancel} autoFocus>Not now</button>
          <button className="primary" disabled={overCap || overBalance} onClick={() => onConfirm(total, draft)}>Spend about {total} credits</button>
        </div>
      </div>
    </div>
  );
}
