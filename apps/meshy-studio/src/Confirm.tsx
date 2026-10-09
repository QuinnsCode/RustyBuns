// Before credits are spent: what goes, what it costs, and what's left after.
import { useEffect } from "react";
import type { Card } from "./api.ts";

export interface SendAsk { cards: Card[]; retry?: boolean }

export function ConfirmSend({ ask, balance, batchCap, onCancel, onConfirm }: {
  ask: SendAsk; balance: number | null; batchCap: number; onCancel: () => void; onConfirm: (credits: number) => void;
}) {
  const total = ask.cards.reduce((n, c) => n + c.estimate, 0);
  const rows = new Map<string, { label: string; n: number; each: number }>();
  for (const c of ask.cards) {
    const k = `${c.presetLabel}/${c.estimate}`;
    const r = rows.get(k) ?? { label: c.presetLabel, n: 0, each: c.estimate };
    r.n++;
    rows.set(k, r);
  }
  const after = balance === null ? null : balance - total;
  const share = balance ? Math.min(1, total / balance) : 0;
  const overCap = batchCap > 0 && total > batchCap;
  const overBalance = after !== null && after < 0;
  const blocked = overCap || overBalance;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  return (
    <div className="scrim center" onClick={onCancel}>
      <div className="modal plate" role="dialog" aria-label="Confirm spend" onClick={(e) => e.stopPropagation()}>
        <h2>{ask.retry ? "Send again" : "Send"} {ask.cards.length} model{ask.cards.length === 1 ? "" : "s"} to Meshy?</h2>
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
          <button className="primary" disabled={blocked} onClick={() => onConfirm(total)}>Spend about {total} credits</button>
        </div>
      </div>
    </div>
  );
}
