// The page side of the spaces journey (spaces-panel.test.ts): the shared panel mounted the way a game mounts it,
// against the eqosys that served this page, signed in with the token in the address.
import { space } from "@rustybuns/util/eqosys";
import { spacesPanel } from "@rustybuns/util/spaces";

const q = new URLSearchParams(location.search);
const token = q.get("token") ?? "";
const box = document.body.appendChild(document.createElement("aside"));
box.id = "spaces";
const icon = (n: string) => Object.assign(document.createElement("i"), { className: `icon-${n}` });
Object.assign(window, { panel: spacesPanel({ box, space: space({ url: () => location.origin, token: () => token }), name: () => q.get("name") ?? undefined, icon }) });
