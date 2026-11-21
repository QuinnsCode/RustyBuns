"use client";

import { useEffect, useRef } from "react";
import { watch } from "./viewer.ts";

// React renders the empty boxes once; viewer.ts paints inside them from then on.
export function Arena() {
  const arena = useRef<HTMLElement>(null);
  const next = useRef<HTMLParagraphElement>(null);
  const replays = useRef<HTMLOListElement>(null);
  useEffect(() => watch(arena.current, replays.current, next.current), []);
  return (
    <>
      <p ref={next} className="next" />
      <section ref={arena} className="arena" aria-live="polite" />
      <h2>Past fights</h2>
      <ol ref={replays} className="replays" />
    </>
  );
}
