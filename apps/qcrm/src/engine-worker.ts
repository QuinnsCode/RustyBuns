// One core's share of the duplicate search: a Web Worker that loads its own copy of the engine.
import { loadEngine } from "./engine.ts";

self.onmessage = async (e: MessageEvent<{ json: string; start: number; end: number }>) => {
  const { json, start, end } = e.data;
  const eng = await loadEngine();
  self.postMessage(eng.dedupe_slice(json, start, end));
};
