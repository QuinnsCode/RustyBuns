// A sesh is public to anyone with its name until its maker sets a code: then joiners type the
// code first (the maker never does). The maker can change it or open the sesh again.
import { useState } from "react";

export function LockButton(props: { locked: boolean; onLock(code: string): void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  if (!open) return (
    <button className="ghost" onClick={() => setOpen(true)} aria-pressed={props.locked}
      title={props.locked ? "Private: joiners need the code" : "Public: anyone with the link can join"}>
      {props.locked ? "Private" : "Public"}
    </button>
  );
  const done = (c: string) => { props.onLock(c); setCode(""); setOpen(false); };
  return (
    <form className="lock" onSubmit={(e) => { e.preventDefault(); done(code.trim()); }}>
      <input required minLength={4} maxLength={32} placeholder={props.locked ? "New code" : "Room code"} value={code} autoFocus
        aria-label="Room code" onChange={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <button className="play">{props.locked ? "Change" : "Make private"}</button>
      {props.locked && <button type="button" className="ghost" onClick={() => done("")}>Make public</button>}
      <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
