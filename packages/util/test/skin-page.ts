// The page skin.test.ts loads: a game's eqosys client with a skin (or the house look with ?house), signed in, with its
// account chip, report form and an achievement toast mounted.
import { celebrate, eqosys } from "../src/eqosys.ts";

const house = location.search.includes("house");
localStorage.setItem("t.eqosys", location.origin);
localStorage.setItem("t.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: "x" }));
const client = eqosys({ app: "t", url: location.origin, from: [], prefix: "t", ...(house ? {} : { skin: { theme: { "--ui-bg": "rgb(28, 33, 40)", "--ui-line": "rgb(156, 122, 42)", "--ui-radius": "1px", "--ui-radius-sm": "1px", "--ui-font": "Courier" }, css: ".eq-who{text-transform:uppercase}" } }) });
document.body.append(client.accountChip(document.createElement("div")));
client.reportButton();
document.querySelector<HTMLButtonElement>(".rb-report .eq-btn")!.click();
celebrate({ id: "played", name: "First muster", blurb: "Played a battle", secret: false, at: 1 }, 0);
