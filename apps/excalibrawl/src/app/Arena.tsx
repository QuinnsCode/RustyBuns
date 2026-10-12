"use client";

import { useEffect, useRef } from "react";
import { watch } from "./viewer.ts";

// React renders the two empty boxes once; viewer.ts paints inside them from then on.
export function Arena() {
  const arena = useRef<HTMLElement>(null);
  const replays = useRef<HTMLOListElement>(null);
  useEffect(() => watch(arena.current, replays.current), []);
  return (
    <>
      <section ref={arena} className="arena" aria-live="polite" />
      <h2>Replays</h2>
      <ol ref={replays} className="replays" />
    </>
  );
}
