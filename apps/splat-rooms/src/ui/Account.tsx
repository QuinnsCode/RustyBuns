import { useEffect, useRef } from "react";
import { accountChip, finishSignIn, reportButton } from "./eqosys.ts";

/** The menu's eqosys account chip, in the scanner's skin (eqosys.ts SKIN): the name and a way out, or a way in. */
export function Account() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => reportButton(), []);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const beside = () => {}; // "Sign in" opens eqosys beside the page, which never reloads; the chip redraws itself
    accountChip(el, { onSignIn: beside });
    // Back from eqosys with ?code=&state=: trade it in and show the name, or what went wrong.
    void finishSignIn().then((back) => { if (back) accountChip(el, { note: back.error, onSignIn: beside }); });
  }, []);
  return <div ref={slot} />;
}
