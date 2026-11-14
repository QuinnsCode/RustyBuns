import { useEffect, useRef } from "react";
import { accountChip } from "../eqosys.ts";

/** The eqosys account chip in the menu, in the tycoon's skin (src/client/eqosys.ts SKIN): the name and a way out, or a way in. */
export function Account({ note }: { note?: string }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => { if (slot.current) accountChip(slot.current, { note, onSignOut: () => location.reload(), onSignIn: () => {} }); }, [note]); // Sign in: eqosys beside the game
  return <div ref={slot} />;
}
