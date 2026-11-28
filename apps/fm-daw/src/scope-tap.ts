// What the page plays: each place that connects to the speakers names its last node with `hear`, and the scope button
// (scope-button.ts) reads them while its scope is open. Only a list: nothing is connected or computed until then.
const heard = new Set<AudioNode>();
const watchers = new Set<(node: AudioNode, on: boolean) => void>();

/** `node`'s first output goes to the speakers. The answer takes it off the list again (a one-shot source that ended). */
export function hear(node: AudioNode): () => void {
  heard.add(node);
  for (const w of watchers) w(node, true);
  return () => { if (heard.delete(node)) for (const w of watchers) w(node, false); };
}

/** Every node on the list now, and each one that joins or leaves, until the answer is called. */
export function watchHeard(fn: (node: AudioNode, on: boolean) => void): () => void {
  watchers.add(fn);
  for (const n of heard) fn(n, true);
  return () => { watchers.delete(fn); };
}
