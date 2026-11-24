// The character picker on the Me tab (#4987, #5009): the shared picker (@rustybuns/models/picker, which Qollab Studio
// also opens as a dialog over its rooms, #5819), reading and saving through GET and PUT /me/avatar (avatar.ts) with the
// session cookie. Someone new (signed up, or signed in without one: ?new=1) is welcomed to it, with a Later link. Its own
// module script, on the Me tab alone, so three.js loads only here. `window.__character` is its handle:
// `bun run probe eqosys "/?tab=account" --js "__character.state()"`.
import { AvatarReply, type Avatar } from "@rustybuns/util/avatar";
import { getJson } from "@rustybuns/util/http";
import { mountPicker } from "@rustybuns/models/picker";

export function mountCharacter(box: HTMLElement) {
  const first = new URLSearchParams(location.search).get("new") === "1";
  return mountPicker(box, {
    load: () => getJson("/me/avatar", AvatarReply, { credentials: "same-origin" }),
    save: (a: Avatar) => getJson("/me/avatar", AvatarReply, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(a) }),
    first: first ? { later: "/" } : null,
  });
}

if (typeof document !== "undefined") {
  const box = document.getElementById("character");
  if (box) void mountCharacter(box).then((h) => Object.assign(window, { __character: h }));
}
