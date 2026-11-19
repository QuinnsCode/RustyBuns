// The amp's worker: bakes each song's guitar stem through the amp as set at soundcheck (amp.ts), off the page's thread,
// and hands each song back as it is done (about two seconds a song). A new ask drops the one in hand between songs.
import { check } from "@rustybuns/util/guard";
import { SET_LIST } from "../venues/show.ts";
import { BAKE_RATE, BakeAsk, type BakeReply, bakeGuitar } from "./amp.ts";
import { stems } from "./stems.ts";

let latest = -1;
const breath = () => new Promise((r) => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent) => {
  const ask = check(BakeAsk, e.data);
  if (!ask) return;
  latest = ask.id;
  for (const [song, s] of SET_LIST.entries()) {
    await breath();
    if (ask.id !== latest) return;
    const data = bakeGuitar(stems(BAKE_RATE, s).guitar, BAKE_RATE, ask.knobs);
    self.postMessage({ id: ask.id, song, data } satisfies BakeReply, { transfer: [data.buffer] });
  }
};
