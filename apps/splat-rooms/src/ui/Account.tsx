import { createElement, LogIn, LogOut } from "lucide";
import { useEffect, useRef, useState } from "react";
import { canSignIn, finishSignIn, login, reportButton, signIn, signOut, type Login } from "./eqosys.ts";

/** A lucide icon (the plain package, no React wrapper). */
function Glyph({ of }: { of: Parameters<typeof createElement>[0] }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => { host.current?.replaceChildren(createElement(of, { width: 16, height: 16 })); }, [of]);
  return <span ref={host} className="glyph" />;
}

/** The menu's account row: the eqosys name with a way out, or a way in where eqosys can send the player back. */
export function Account() {
  const [who, setWho] = useState<Login | null>(login);
  const [note, setNote] = useState("");
  // Back from eqosys with ?code=&state=: trade it in and show the name.
  useEffect(() => reportButton(), []);
  useEffect(() => { void finishSignIn().then((back) => { if (back) { setWho(back.login); setNote(back.error ?? ""); } }); }, []);
  if (!who && !canSignIn()) return null;
  return (
    <p className="account dim small">
      {who ? (
        <>
          <b className="rider">{who.name}</b>
          <button className="back" title="Sign out" aria-label="Sign out" onClick={() => { signOut(); setWho(null); }}><Glyph of={LogOut} /></button>
        </>
      ) : (
        <button className="back" title="Sign in" aria-label="Sign in" onClick={() => void signIn()}><Glyph of={LogIn} /></button>
      )}
      {note && <span className="warn"> {note}</span>}
    </p>
  );
}
