// The Python thread. One interpreter per process, and calls run one at a time.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { num, obj, str } from "@rustybuns/util/guard";
import { startPython } from "./libpython.ts";

declare const self: Worker;
const Job = obj({ id: num(0, Number.MAX_SAFE_INTEGER), request: str(1_000_000) });

/** PYTHON_APP, else ./python, else the python/ folder beside the binary. */
const appDir = () => {
  const chosen = process.env.PYTHON_APP;
  if (chosen) return resolve(chosen);
  const here = join(process.cwd(), "python");
  return existsSync(here) ? here : join(dirname(process.execPath), "python");
};

let call: ((request: string) => string) | undefined;
self.onmessage = (e: MessageEvent) => {
  const { id, request } = Job(e.data);
  try {
    call ??= startPython(appDir());
    self.postMessage({ id, reply: call(request) });
  } catch (err) {
    self.postMessage({ id, reply: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) });
  }
};
