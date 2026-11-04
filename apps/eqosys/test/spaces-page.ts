// The page side of the spaces journey (spaces-panel.test.ts): the shared panel mounted the way a game mounts it,
// against the eqosys that served this page, signed in with the token in the address. Voice joins a stand-in for Qlave's
// `join` (`window.voice`): it records the ticket and lists this page alone in the room, and `voice.gone(why)` closes it.
import { space } from "@rustybuns/util/eqosys";
import { spacesPanel, type VoiceCall } from "@rustybuns/util/spaces";
import type { GoneReason, Speaker } from "@rustybuns/util/voice";

const q = new URLSearchParams(location.search);
const token = q.get("token") ?? "";
const box = document.body.appendChild(document.createElement("aside"));
box.id = "spaces";
const icon = (n: string) => Object.assign(document.createElement("i"), { className: `icon-${n}` });
const voice = { tickets: [] as string[], muted: false, left: false, gone: (_: GoneReason) => {} };
const join = async (url: string, ticket: string): Promise<VoiceCall> => {
  voice.tickets.push(`${url} ${ticket}`);
  let speakers = (_: Speaker[]) => {};
  const me = (muted: boolean): Speaker[] => [{ sub: "me", name: q.get("name") ?? "", talking: false, muted, self: true }];
  return {
    leave: () => { voice.left = true; },
    muteSelf: (on) => { voice.muted = on; speakers(me(on)); },
    onSpeakers: (f) => { speakers = f; f(me(false)); return () => {}; },
    onGone: (f) => { voice.gone = f; return () => {}; },
  };
};
Object.assign(window, { voice, panel: spacesPanel({ box, space: space({ url: () => location.origin, token: () => token }), name: () => q.get("name") ?? undefined, icon, join }) });
