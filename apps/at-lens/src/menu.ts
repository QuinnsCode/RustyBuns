// The Cmd/Ctrl+K menu (and the same functions as WebMCP tools): look up a handle, sign in, sign out. Each fills the
// page's own form and sends it, so it goes the way a click does.
import { addCommands, buttonCommand, type Command } from "@rustybuns/util/commands";
import { obj, str } from "@rustybuns/util/guard";
import { mountPalette } from "@rustybuns/util/palette";

const Handle = obj({ handle: str(2048) });

function send(form: string, input: string, args: unknown) {
  const f = document.querySelector<HTMLFormElement>(form), box = document.querySelector<HTMLInputElement>(input);
  if (!f || !box) throw new Error("That box isn't on the page right now");
  box.value = Handle(args).handle.trim();
  f.requestSubmit();
}
const oneHandle = { type: "object", properties: { handle: { type: "string" } }, required: ["handle"] } as const;

const look: Command = { name: "lens_look", title: "Look up a handle", description: "Walk a handle or DID: DID, data server, collections and its live feed.",
  ask: "atproto.com or did:plc:...", inputSchema: oneHandle, execute: (a) => send("#ask", "#q", a) };

addCommands([
  look,
  { name: "lens_sign_in", title: "Sign in to write", description: "Start the OAuth sign-in for a handle; the browser goes to its data server.",
    ask: "your.handle", inputSchema: oneHandle, execute: (a) => send("#signin", "#handle", a) },
  buttonCommand("#signout", { name: "lens_sign_out", title: "Sign out", description: "Sign out of this page." }),
]);
mountPalette({ button: true });
