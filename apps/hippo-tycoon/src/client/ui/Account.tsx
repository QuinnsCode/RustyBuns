import { LogIn, LogOut } from "lucide";
import { canSignIn, login, signIn, signOut } from "../eqosys.ts";

type Node = [tag: string, attrs: Record<string, string | number | undefined>][];
const Icon = ({ node }: { node: Node }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {node.map(([tag, attrs], i) => (tag === "path" ? <path key={i} d={String(attrs.d)} /> : tag === "polyline" ? <polyline key={i} points={String(attrs.points)} /> : tag === "line" ? <line key={i} x1={attrs.x1} y1={attrs.y1} x2={attrs.x2} y2={attrs.y2} /> : null))}
  </svg>
);

/** Signed in, the eqosys name with a way out; otherwise a way in, shown only where eqosys can send the player back. */
export function Account({ note }: { note?: string }) {
  const who = login();
  if (who) return (
    <div className="row">
      <span style={{ flex: 1 }}>Signed in as <b>{who.name}</b></span>
      <button className="btn" title="Sign out" aria-label="Sign out" onClick={() => { signOut(); location.reload(); }}><Icon node={LogOut as Node} /></button>
    </div>
  );
  if (!canSignIn() && !note) return null;
  return (
    <div className="row">
      {note && <span className="hint" style={{ flex: 1 }}>{note}</span>}
      {canSignIn() && <button className="btn" style={{ marginLeft: "auto" }} title="Sign in" aria-label="Sign in" onClick={() => void signIn()}><Icon node={LogIn as Node} /></button>}
    </div>
  );
}
