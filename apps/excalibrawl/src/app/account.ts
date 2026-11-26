"use client";
// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this app's id. Made on first use,
// in the browser only (it reads localStorage and puts the skin on the page). Posts and reactions go straight from here to
// Qollab with the token it keeps; the Worker never sees it.

import { useEffect, useState } from "react";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS } from "../board.ts";

/** The origin eqosys sends people back to. A local page stays signed out (or set `excalibrawl.eqosys` to a local eqosys). */
const SIGN_IN_FROM = ["https://excalibrawl.notryanquinn.workers.dev"];

/** The site's look on eqosys's chip: whiteboard paper, ink, the one violet, soft rounded corners (styles.css). */
const SKIN = {
  theme: {
    "--ui-bg": "var(--paper)", "--ui-ink": "var(--ink)", "--ui-dim": "var(--dim)", "--ui-line": "var(--line)", "--ui-soft": "rgba(105, 101, 219, 0.06)",
    "--ui-accent": "var(--hot)", "--ui-accent-soft": "rgba(105, 101, 219, 0.15)", "--ui-on-accent": "#fff",
    "--ui-radius": "10px", "--ui-radius-sm": "8px", "--ui-border": "2px",
  },
  css: ".eq-who,.eq-btn{font-weight:800}",
};

let client: ReturnType<typeof eqosys> | undefined;
export const account = () => (client ??= eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "excalibrawl", skin: SKIN }));

const ears = new Set<() => void>();
/** Tell every part of the page that someone signed in or out. */
export const changed = () => { for (const f of ears) f(); };

/** Whether someone is signed in, kept in step with the chip. False on the server and before the page wakes. */
export function useSignedIn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = () => setOn(!!account().login());
    f();
    ears.add(f);
    return () => { ears.delete(f); };
  }, []);
  return on;
}

/**
 * Signed in already, or signed in now through eqosys's small window beside the page, so a running fight keeps running.
 * Call it straight from the click (nothing awaited first) or the browser blocks the window. False with a note when not.
 */
export async function signedIn(note: (s: string) => void): Promise<boolean> {
  const a = account();
  if (a.login()) return true;
  if (!a.canSignIn()) { note("Posting and reacting need an eqosys account, on the online version."); return false; }
  const r = await a.signInHere();
  if (r.login) { changed(); return true; }
  if (r.error) note(r.error);
  return false;
}
