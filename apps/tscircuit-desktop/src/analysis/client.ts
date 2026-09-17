// Main-thread handle on the analysis worker.
import type { Timed } from "../api.ts";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let seq = 0;
const pending = new Map<number, { resolve: (t: Timed) => void; reject: (e: Error) => void }>();
worker.onmessage = (e) => {
  const { id, error, ...rest } = e.data;
  const p = pending.get(id);
  pending.delete(id);
  if (error) p?.reject(new Error(error));
  else p?.resolve(rest as Timed);
};

export function analyzeInBrowser(text: string, min: number): Promise<Timed> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, text, min });
  });
}
