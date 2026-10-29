// No seat: this sesh has every player it takes, or every room on the edge is open (or kept).
// Leave an email for the list, try again, or play on alone without saving.
import { useState } from "react";
import type { Full } from "../project.ts";

export function FullCard(props: { why: Full; room: string | null; onRetry(): void; onSolo(): void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ busy?: boolean; place?: number; error?: string }>({});
  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await fetch("/signup", { method: "POST", body: JSON.stringify({ email, room: props.room ?? "" }) });
      const v: unknown = await r.json().catch(() => null);
      const o = typeof v === "object" && v !== null ? v : {};
      if ("place" in o && typeof o.place === "number") setState({ place: o.place });
      else setState({ error: "error" in o && typeof o.error === "string" ? o.error : r.status === 429 ? "Too many tries, wait a minute" : "That didn't go through" });
    } catch { setState({ error: "That didn't go through" }); }
  }
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="full-title">
      <div className="gate-card">
        <h2 id="full-title">{props.why === "room" ? "This sesh is full" : "Every room is taken"}</h2>
        <p>{props.why === "room"
          ? "Every seat in this sesh has a player. Try again in a bit, or start your own sesh."
          : "FM DAW keeps a few rooms open at once while it grows. Leave your email and you're on the list for more."}</p>
        {state.place
          ? <p role="status">You're on the list, number {state.place}.</p>
          : <form className="signup" onSubmit={signUp}>
              <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} aria-label="Email" />
              <button className="play" disabled={state.busy}>Sign up</button>
            </form>}
        {state.error && <p className="err">{state.error}</p>}
        <div className="signup">
          <button className="ghost" onClick={props.onRetry}>Try again</button>
          {props.why === "room" && <button className="ghost" onClick={() => { location.href = "/"; }}>New sesh</button>}
          <button className="ghost" onClick={props.onSolo}>Play alone (not saved)</button>
        </div>
      </div>
    </div>
  );
}
