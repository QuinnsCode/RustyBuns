"use client";
// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this app's id. Made on first use,
// in the browser only (it reads localStorage and puts the skin on the page). Posts and signed-in reactions go straight
// from here to Qollab with the token it keeps; the Worker never sees it.

import { useEffect, useState } from "react";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS } from "../board.ts";

/** The origin eqosys sends people back to. A local page stays signed out (or set `wwfs.eqosys` to a local eqosys). */
const SIGN_IN_FROM = ["https://what-would-fantano-say.notryanquinn.workers.dev"];

/** The site's look on eqosys's chip: black, bone white, the one loud yellow, hard edges, heavy capitals (styles.css). */
const SKIN = {
  theme: {
    "--ui-bg": "var(--panel)", "--ui-ink": "var(--fg)", "--ui-dim": "var(--dim)", "--ui-line": "var(--line)", "--ui-soft": "rgba(255, 255, 255, 0.06)",
    "--ui-accent": "var(--hot)", "--ui-accent-soft": "rgba(255, 212, 0, 0.15)", "--ui-on-accent": "var(--bg)",
    "--ui-radius": "0", "--ui-radius-sm": "0", "--ui-border": "2px",
  },
  css: ".eq-who,.eq-btn{font-weight:900;letter-spacing:.02em;text-transform:uppercase}",
};

let client: ReturnType<typeof eqosys> | undefined;
export const account = () => (client ??= eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "wwfs", skin: SKIN }));

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
