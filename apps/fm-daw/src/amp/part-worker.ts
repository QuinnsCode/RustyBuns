// A worker playing one part of a rig split across threads (ring.ts): frames in from the part before it, out
// to the next (or back to the audio thread), with its tubes' levels, work and load reported 30 times a second.
import { PartRunner, REPORT_EVERY, Ring } from "./ring.ts";
import type { FromAmp, ToPart } from "./messages.ts";

let runner: PartRunner | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<ToPart>) => {
  const m = e.data;
  if (m.t === "start") {
    const r = new PartRunner(m.index, m.rings.map((x) => new Ring(x)), m.sampleRate, () => performance.now());
    runner = r;
    void r.run();
    timer = setInterval(() => {
      const rig = r.live?.rig;
      const msg: FromAmp = { t: "meter", levels: rig ? rig.levels() : [], out: 0, load: r.load(), misses: rig?.misses ?? 0, work: rig?.work() ?? [], part: r.index };
      postMessage(msg);
    }, REPORT_EVERY * 1000);
  } else if (m.t === "set") runner?.set(m);
  else {
    if (runner) runner.stopped = true;
    if (timer) clearInterval(timer);
    close();
  }
};
