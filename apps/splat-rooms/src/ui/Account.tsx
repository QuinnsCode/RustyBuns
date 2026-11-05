import { useEffect, useRef } from "react";
import { accountChip, finishSignIn, reportButton } from "./eqosys.ts";

/** The menu's eqosys account chip, in the lab skin (eqosys.ts SKIN): the name and a way out, or a way in. */
export function Account() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => reportButton(), []);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    accountChip(el);
    // Back from eqosys with ?code=&state=: trade it in and show the name, or what went wrong.
    void finishSignIn().then((back) => { if (back) accountChip(el, { note: back.error }); });
  }, []);
  return <div ref={slot} />;
}
