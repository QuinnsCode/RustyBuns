"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.tsx";
import { expose, match, type Command } from "./commands.ts";

/** The Ctrl/Cmd-K menu over the command registry. */
export function Palette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    expose();
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setAt(0); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  if (!open) return null;
  const hits = match(q).slice(0, 12);
  const go = (c: Command | undefined) => { if (!c) return; setOpen(false); void c.run(); };
  return (
    <div className="palette-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="palette" role="dialog" aria-label="Command menu">
        <input ref={input} value={q} placeholder="Type a command…" aria-label="Command" onChange={(e) => { setQ(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") go(hits[at]);
          }} />
        <ul>
          {hits.map((c, i) => <li key={c.id}><button type="button" data-command={c.id} className={i === at ? "on" : ""} onMouseEnter={() => setAt(i)} onClick={() => go(c)}><Icon name={c.icon ?? "search"} /> {c.title}</button></li>)}
          {!hits.length && <li className="empty">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
