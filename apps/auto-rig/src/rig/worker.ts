// The TypeScript rigger off the main thread, for the plain browser build.
import { analyze, type RigOptions } from "./analyze.ts";

self.onmessage = (e: MessageEvent<{ pos: Float32Array; idx: Uint32Array; opts: Partial<RigOptions> }>) => {
  try {
    const t0 = performance.now();
    const r = analyze(e.data.pos, e.data.idx, e.data.opts);
    const ms = performance.now() - t0;
    (self as unknown as Worker).postMessage({ ok: true, r, ms }, [r.joints.buffer, r.parents.buffer, r.skinIndex.buffer, r.skinWeight.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error).message ?? err) });
  }
};
