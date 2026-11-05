// The face test's models, in a Bun worker of their own. On Bun's main thread ONNX Runtime thinks it
// is in a web worker and takes over self.onmessage, after which no other Worker's reply arrives (the
// engine test's search pools hung). Here it can have this thread: one message in, the faces out.
import { join } from "node:path";
import { decode as jpeg } from "jpeg-js";
import { arr, obj, str } from "@rustybuns/util/guard";
import type { Face } from "../src/faces/face.ts";
import { findFaces, loadModels } from "../src/faces/run.ts";

const Job = obj({ photos: arr(str(4096), 100), models: str(4096) });

self.onmessage = async (e: MessageEvent<unknown>) => {
  const { photos, models } = Job(e.data);
  const m = await loadModels(async (f) => new Uint8Array(await Bun.file(join(models, f)).arrayBuffer()));
  const faces: Face[] = [];
  for (const [p, file] of photos.entries()) faces.push(...(await findFaces(m, jpeg(new Uint8Array(await Bun.file(file).arrayBuffer()), { useTArray: true }), p)));
  (self as unknown as Worker).postMessage(faces);
};
