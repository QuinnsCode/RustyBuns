// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// prepare() off the main thread. Bundled inline (a blob: URL), since a page may not start a Worker from the
// widget's own origin; viewer.ts falls back to running prepare() in the page when a CSP refuses blob: workers.
import { prepare } from "./image.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (e: MessageEvent<{ id: number; file: Blob }>) => {
  const { id, file } = e.data;
  try {
    const p = await prepare(file);
    scope.postMessage({ id, ok: p }, [p.bitmap]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
