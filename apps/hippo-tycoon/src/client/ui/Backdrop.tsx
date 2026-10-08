// The menu's backdrop: the real island behind the cards, the camera drifting round
// it high enough to see the sunset and the peaks. The geyser fires now and then and
// a hippo bellows. Decoration only, so it is hidden from screen readers; reduced
// motion holds the camera still and the quality preset applies as in a round.
import { useEffect, useRef } from "react";
import { GOLD, OIL, SEATS, BELLOW_TICKS } from "../../sim/rules.ts";
import type { Event } from "../../sim/types.ts";
import { Renderer } from "../render/index.ts";
import { stillFrame } from "../render/still.ts";
import type { ViewSettings } from "../settings.ts";

export function Backdrop({ view }: { view: ViewSettings }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const viewRef = useRef(view); viewRef.current = view;

  useEffect(() => {
    let r: Renderer;
    try { r = renderer.current = new Renderer(canvas.current!, overlay.current!, { mode: "attract", view: viewRef.current }); }
    catch { return; }                                   // no WebGL: the CSS gradient behind it is enough
    let raf = 0, nextShot = performance.now() + 1200, roar = -1, roarUntil = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const events: Event[] = [];
      if (now > nextShot) { events.push({ t: "spawn", kind: Math.random() < 0.2 ? GOLD : OIL }); nextShot = now + 900 + Math.random() * 1600; }
      if (now > roarUntil + 3500 && Math.random() < 0.01) { roar = Math.floor(Math.random() * SEATS); roarUntil = now + 700; }
      const bellow = now < roarUntil ? Math.ceil(((roarUntil - now) / 700) * BELLOW_TICKS) : 0;
      r.draw(stillFrame({ phase: "lobby", events, hippos: Array.from({ length: SEATS }, (_, i) => ({ bellow: i === roar ? bellow : 0 })) }), now);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); r.dispose(); renderer.current = null; };
  }, []);

  useEffect(() => { renderer.current?.setView(view); }, [view]);

  return (
    <div className="backdrop" aria-hidden>
      <canvas ref={canvas} />
      <div ref={overlay} />
    </div>
  );
}
