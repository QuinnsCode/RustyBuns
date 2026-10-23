"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons.tsx";

// null = asked and signed out, undefined = still asking (show neither set of buttons, so no flash of "Sign in").
export const Nav = ({ inner }: { inner?: boolean }) => {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const ask = () => fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setEmail(m?.user?.email ?? null))
      .catch(() => setEmail(null));
    void ask();
    // The CRM signs in (or the demo frame makes its account) after the nav first asked.
    window.addEventListener("qcrm-session", ask);
    return () => window.removeEventListener("qcrm-session", ask);
  }, []);
  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    location.href = "/";
  };
  return (
    <nav className="wrap nav">
      <a className="brand" href="/"><Icon name="waves" size={20} /> q<b>CRM</b></a>
      <span className="grow" />
      {!inner && <a href="/#edge">Why</a>}
      {!inner && <a href="/#mcp">Agents</a>}
      <a href="/privacy">Privacy</a>
      {email === null && <a className="btn" href="/demo"><Icon name="flask-conical" /> Demo</a>}
      {email === null && <a className="btn primary" href="/app">Sign in</a>}
      {email && <a className="btn" href="/app" title="Open your org"><Icon name="users" /> <span className="nav-email">{email}</span></a>}
      {email && <button type="button" className="btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="log-out" /></button>}
    </nav>
  );
};
