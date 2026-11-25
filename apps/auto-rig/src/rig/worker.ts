// The TypeScript rigger off the main thread: a Web Worker in the page, and a
// worker thread on the desktop host (src/actions/rig.ts). One message in, one answer out.
import { analyze, type RigOptions } from "@rustybuns/rig";

self.onmessage = (e: MessageEvent<{ pos: Float32Array; idx: Uint32Array; opts: Partial<RigOptions> }>) => {
  try {
    const t0 = performance.now();
    const r = analyze(e.data.pos, e.data.idx, e.data.opts);
    const ms = performance.now() - t0;
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- this file runs in a Worker, but the app is typed with the DOM's lib, where self is a Window
    (self as unknown as Worker).postMessage({ ok: true, r, ms }, [r.joints.buffer, r.parents.buffer, r.skinIndex.buffer, r.skinWeight.buffer]);
  } catch (err) {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- this file runs in a Worker, but the app is typed with the DOM's lib, where self is a Window
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error).message ?? err) });
  }
};
