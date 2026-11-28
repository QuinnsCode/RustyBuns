// The world's frame on the page, swapped for a fresh one each time its document changes: Chrome can drop a new srcdoc
// set while the last one is still loading. The old frame stops being drawn before it goes (#6517). Sealed frames share
// a renderer, and with no GPU (CI, a VM) removing one mid-draw can wedge it, so the new world never runs at all.
import { Component, Mount } from "@effect/ui";
import { Effect, Schema, Stream } from "effect";

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

export const WorldFrame = Mount.make("WorldFrame", { args: { doc: Schema.String } }, (host: Element, _args, changes) =>
  Stream.runForEach(changes, ({ doc }) => Effect.promise(() => show(host, doc))).pipe(Effect.as(Component.noop)));
