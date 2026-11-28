// Host side: `await callPython("summarize", [[1, 2, 3]], Summary)`.
import { bool, num, obj, opt, raw, str, type Guard } from "@rustybuns/util/guard";

const Answer = obj({ id: num(0, Number.MAX_SAFE_INTEGER), reply: str(10_000_000) });
const Reply = obj({ ok: bool(), value: opt(raw), error: opt(str(10_000)), traceback: opt(str(100_000)) });

let worker: Worker | undefined;
let next = 0;
const waiting = new Map<number, (reply: string) => void>();

function python() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url));
  worker.onmessage = (e: MessageEvent) => {
    const { id, reply } = Answer(e.data);
    waiting.get(id)?.(reply);
    waiting.delete(id);
  };
  return worker;
}

export async function callPython<T>(fn: string, args: unknown[], shape: Guard<T>): Promise<T> {
  const id = next++;
  const reply = await new Promise<string>((done) => {
    waiting.set(id, done);
    python().postMessage({ id, request: JSON.stringify({ fn, args }) });
  });
  const r = Reply(JSON.parse(reply));
  if (!r.ok) {
    if (r.traceback) console.error(r.traceback);
    throw new Error(r.error ?? "Python failed");
  }
  return shape(r.value);
}
