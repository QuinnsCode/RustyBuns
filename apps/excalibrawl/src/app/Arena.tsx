"use client";

import { useEffect, useRef, useState } from "react";
import { watch } from "./viewer.ts";
import { FightReactions, Prompts } from "./Board.tsx";
import { fightRef } from "../board.ts";
import COPY from "../../content/first-screen.json";

// React renders the empty boxes once; viewer.ts paints inside them from then on, and says which fight is up for its reactions.
export function Arena() {
  const arena = useRef<HTMLElement>(null);
  const next = useRef<HTMLParagraphElement>(null);
  const replays = useRef<HTMLOListElement>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => watch(arena.current, replays.current, next.current, setShown), []);
  return (
    <>
      <p ref={next} className="next" />
      <section ref={arena} className="arena" aria-live="polite" />
      <FightReactions thing={shown && fightRef(shown)} />
      <Prompts />
      <h2>{COPY.pastFights}</h2>
      <ol ref={replays} className="replays" />
    </>
  );
}
