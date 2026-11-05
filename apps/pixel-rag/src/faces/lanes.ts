// The page's side of face-worker.ts: either lane (wasm in the worker, or native on the desktop host
// through it), behind one shape. The page's thread only copies the pixels over and gets faces back.
import type { Face, Pixels } from "./face.ts";
import type { FaceJob, FaceLaneId, FaceReply } from "./face-worker.ts";

export interface FaceLane {
  id: FaceLaneId;
  /** The faces on one picture, and how long the lane took over them (for native, the trip to the host too). */
  find(p: Pixels, page: number): Promise<{ faces: Face[]; ms: number }>;
  stop(): void;
}

/** A lane on a worker `spawn` makes; wasm loads the models from `base` on `threads` wasm threads. Rejects with why it can't. */
export async function faceLane(spawn: () => Worker, id: FaceLaneId, base: string, threads: number): Promise<FaceLane> {
  const w = spawn();
  const waiting = new Map<number, (r: Extract<FaceReply, { type: "found" }>) => void>();
  let loaded: (r: Extract<FaceReply, { type: "loaded" }>) => void = () => {};
  w.onmessage = (e: MessageEvent<FaceReply>) => {
    const r = e.data;
    if (r.type === "loaded") loaded(r);
    else { waiting.get(r.id)?.(r); waiting.delete(r.id); }
  };
  const send = (j: FaceJob, transfer: Transferable[] = []) => w.postMessage(j, transfer);
  const r = await new Promise<Extract<FaceReply, { type: "loaded" }>>((ok) => { loaded = ok; send({ type: "load", lane: id, base, threads }); });
  if (r.error) { w.terminate(); throw new Error(r.error); }
  let next = 0, queue: Promise<unknown> = Promise.resolve();
  return {
    id,
    // One photo at a time: the worker's two sessions take one run each.
    find(p, page) {
      const n = next++, data = p.data.slice();
      const job = queue.then(() => new Promise<{ faces: Face[]; ms: number }>((ok, no) => {
        waiting.set(n, (f) => (f.error ? no(new Error(f.error)) : ok({ faces: f.faces, ms: f.ms })));
        send({ type: "find", id: n, data, width: p.width, height: p.height, page }, [data.buffer]);
      }));
      queue = job.catch(() => {});
      return job;
    },
    stop: () => w.terminate(),
  };
}
