// Q Builder's bench thread: the riff through a pedal (about a second of work for the fuzz), so the page never stalls.
// Each ask is answered once; the page drops an answer to an ask it has since replaced.
import { builderPedal, play, retest, swing, theRiff } from "../circuit/builder.ts";
import type { BenchAsk, BenchReply } from "./messages.ts";

self.onmessage = (e: MessageEvent<BenchAsk>) => {
  const m = e.data, def = builderPedal(m.pedal), input = theRiff();
  let reply: BenchReply;
  try {
    if (m.t === "retest") reply = { t: "retest", id: m.id, retest: retest(def, m.drive, m.swaps, input) };
    else {
      const p = play(def.net(m.drive, m.swaps), input, m.node);
      const at = p.at ?? new Float32Array(0);
      reply = { t: "play", id: m.id, out: p.out, at, swing: swing(at), misses: p.misses };
      postMessage(reply, { transfer: [p.out.buffer, at.buffer] });
      return;
    }
  } catch (err) {
    reply = { t: "error", id: m.id, why: err instanceof Error ? err.message : String(err) };
  }
  postMessage(reply);
};
