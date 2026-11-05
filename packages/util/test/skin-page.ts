// The page skin.test.ts loads: a game's eqosys client with a skin (or the house look with ?house), signed in, with its
// account chip, report form, an achievement toast, a party lobby and the spaces panel mounted (the last two on stand-in clients).
import { celebrate, eqosys } from "../src/eqosys.ts";
import { lobbyPanel } from "../src/lobby.ts";
import { spacesPanel } from "../src/spaces.ts";

const house = location.search.includes("house");
localStorage.setItem("t.eqosys", location.origin);
localStorage.setItem("t.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: "x" }));
const client = eqosys({ app: "t", url: location.origin, from: [], prefix: "t", ...(house ? {} : { skin: { theme: { "--ui-bg": "rgb(28, 33, 40)", "--ui-line": "rgb(156, 122, 42)", "--ui-radius": "1px", "--ui-radius-sm": "1px", "--ui-font": "Courier" }, css: ".eq-who{text-transform:uppercase}" } }) });
document.body.append(client.accountChip(document.createElement("div")));
client.reportButton();
document.querySelector<HTMLButtonElement>(".rb-report .eq-btn")!.click();
celebrate({ id: "played", name: "First muster", blurb: "Played a battle", secret: false, at: 1 }, 0);
const noop = () => {};
const party = { join: noop, leave: noop, ready: noop, start: noop, onMembers: noop, onRefused: noop, onGone: noop, onStart: noop } as unknown as Parameters<typeof lobbyPanel>[0]["party"];
lobbyPanel({ code: "KRTZ", box: document.body.appendChild(document.createElement("div")), party, name: () => "Ada", link: () => location.href, onStart: noop });
const space = { mine: async () => [], close: noop } as unknown as Parameters<typeof spacesPanel>[0]["space"];
spacesPanel({ box: document.body.appendChild(document.createElement("div")), space, name: () => "Ada", icon: () => document.createElement("i") });
