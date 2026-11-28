// The world's frame on the page, swapped for a fresh one each time its document changes: Chrome can drop a new srcdoc
// set while the last one is still loading. The old frame stops being drawn before it goes (#6517). Sealed frames share
// a renderer, and with no GPU (CI, a VM) removing one mid-draw can wedge it, so the new world never runs at all.
import { Html } from "@effect/ui/html";
import { field } from "@rustybuns/util/guard";
import { Schema } from "effect";
import { MODEL_NAME, SAID_KEY } from "./world.ts";

/** Two of the page's frames, so a hidden frame has stopped drawing. A tab in the background draws neither (and gets
 *  no animation frames), and a covered window may not: neither holds the new world up. */
const undrawn = () => new Promise<void>((done) => {
  if (document.hidden) return done();
  setTimeout(done, 500);
  requestAnimationFrame(() => requestAnimationFrame(() => done()));
});

async function show(host: Element, doc: string) {
  const old = host.querySelector("iframe");
  if (old) {
    // No longer `.world` at once: nothing it still says is the new world's (agent.ts, pictures.ts).
    old.className = "";
    old.style.display = "none";
    await undrawn();
  }
  const frame = document.createElement("iframe");
  frame.className = "world";
  for (const [name, value] of Object.entries({ sandbox: "allow-scripts allow-pointer-lock", referrerpolicy: "no-referrer", title: "Your world", allow: "fullscreen" })) frame.setAttribute(name, value);
  frame.srcdoc = doc;
  host.replaceChildren(frame);
}

/** The world asked for a model the room keeps (kit.ts's model): fetched here, as its sealed frame has no network, and
 *  only its bytes handed in. The room's link is its key, so nothing sent in names the room. */
async function hand(to: Window, room: string, name: string) {
  const answer = (more: { bytes: ArrayBuffer } | { error: string }) => to.postMessage({ agentworld: true, file: name, ...more }, "*");
  if (!MODEL_NAME.test(name)) return answer({ error: "a model is a .glb with a plain lowercase name, like hero.glb" });
  try {
    const res = await fetch(`/api/r/${room}/files/${name}`);
    if (!res.ok) return answer({ error: res.status === 404 ? `the room keeps no ${name}` : `couldn't load it (${res.status})` });
    answer({ bytes: await res.arrayBuffer() });
  } catch { answer({ error: "couldn't load it: no connection" }); }
}

/** `<world-frame>`: give it `doc` and it shows that document in a fresh frame, one swap after another, and hands that
 *  frame the models of `room` it asks for. A custom element,
 *  not a mount: the page's scene tests render it without a browser and have nothing to acknowledge. */
export const WorldFrame = Html.customElement({ tag: "world-frame", properties: { room: Schema.String, doc: Schema.String } });

if (typeof customElements !== "undefined") customElements.define(WorldFrame.tag, class extends HTMLElement {
  private swaps = Promise.resolve();
  room = "";
  // Listening from before there is a frame, so no world asks too early to be heard. Only the frame showing now.
  private heard = (e: MessageEvent) => {
    const frame = this.querySelector<HTMLIFrameElement>("iframe.world");
    if (!frame?.contentWindow || e.source !== frame.contentWindow || field(e.data, SAID_KEY) !== true || field(e.data, "kind") !== "file") return;
    void hand(frame.contentWindow, this.room, String(field(e.data, "name")));
  };
  connectedCallback() { addEventListener("message", this.heard); }
  disconnectedCallback() { removeEventListener("message", this.heard); }
  set doc(doc: string) { this.swaps = this.swaps.then(() => show(this, doc)); }
});
