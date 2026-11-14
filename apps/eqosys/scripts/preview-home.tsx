// The home and sign-in pages, rendered with a made-up person, friends, party and spaces, served with the app's pictures, and
// shot at an iPhone XR and a MacBook Pro's sizes: `bun scripts/preview-home.tsx [outdir]` (or `--serve` to keep it up).
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { Login } from "../src/app/Login.tsx";
import { Home, tabOf } from "../src/app/pages.tsx";
import type { Me } from "../src/auth.ts";
import type { HubState } from "../src/qollab/hub.ts";
import type { Side } from "../src/qollab/side.ts";
import { APPS } from "../src/apps.ts";
import type { Studio } from "../src/studios.ts";
import { PORTS } from "@rustybuns/util/ports";

const me: Me = { id: "1", email: "sam@example.com", name: "Sam" };
const day = 86_400_000, now = Date.now();
const mine = { id: "1", name: "Sam", email: "sam@example.com", source: "eqosys", created_at: now - 30 * day,
  apps: [["git-recon", 1], ["skate-tech-park", 2], ["alien-disc-golf", 4], ["two-fronts", 9]].map(([app, d]) => ({ app: String(app), access: [], last_at: now - Number(d) * day })) };
const hub: HubState = { me: { id: "1", name: "Sam" }, incoming: [{ id: "9", name: "Jo", at: now }], outgoing: [], notes: [],
  friends: [{ id: "2", name: "Riley", since: 0, presence: [{ app: "skate-tech-park", doing: "kickflips" }] }, { id: "3", name: "Max", since: 0, presence: [] }, { id: "4", name: "Ava", since: 0, presence: [{ app: "park-hide-seek", doing: "" }] }] };
const side: Side = { more: 0, spaces: [{ id: "a", name: "Skate crew", owner: true, on: 2 }, { id: "b", name: "Family", owner: false, on: 0 }],
  party: { code: "KQ7X", app: "park-hide-seek", size: 4, members: [{ id: "1", name: "Sam", ready: true, host: true }, { id: "2", name: "Riley", ready: false, host: false }] } };

const studios: Studio[] = [{ id: "q", name: "Sam's Studio", kind: "business", role: "owner", members: 2, space: null,
  people: [{ name: "Sam", email: "sam@example.com", role: "owner" }, { name: "Riley", email: "riley@example.com", role: "maker" }],
  apps: APPS.slice(0, 4).map((a, i) => ({ id: a.id, name: a.name, play: a.origins[0] ?? null, make: i % 2 ? "qntbr/repo" : null, ship: "live", shipped: null })) }];

const page = (url: URL) => "<!doctype html>" + renderToStaticMarkup(<Document>{url.pathname === "/login"
  ? <Login ask={null} me={null} social={["apple", "google", "github"]} appleTop t0={Number(url.searchParams.get("t") ?? 90)} />
  : <Home counts={new Map()} t0={Number(url.searchParams.get("t") ?? 90)} me={me} mine={mine} hub={hub} side={side} everyone={null}
    unlocks={new Map([["git-recon", new Map([["first-run", 1]])]])} tab={tabOf(url.searchParams.get("tab"))} studios={studios} />}</Document>);

const srv = Bun.serve({ port: Number(process.env.PORT ?? (process.argv.includes("--serve") ? PORTS.eqosysPreview : 0)), fetch: async (r) => {
  const url = new URL(r.url), file = Bun.file(join(import.meta.dir, "../public", url.pathname));
  if (url.pathname === "/" || url.pathname === "/login") return new Response(page(url), { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });
if (process.argv.includes("--serve")) console.log(`http://127.0.0.1:${srv.port}/`);
else {
  const out = process.argv[2] ?? ".";
  const chrome = await launchChrome();
  for (const [name, w, h, mobile] of [["xr", 414, 896, true], ["mbp", 1512, 945, false]] as const)
    for (const path of ["/", "/login", "/?t=250"]) {
      const tab = await openTab(chrome.cdp, { w, h }, mobile);
      await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}${path}`, 800);
      const { data } = await tab.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(await tab.eval<number>("document.documentElement.scrollHeight"), h * 3), scale: 1 } });
      const file = join(out, `${name}-${path.replace(/\W+/g, "_") || "home"}.png`);
      await Bun.write(file, Buffer.from(data, "base64"));
      // And the screen as it is, so what is fixed to it (the phone's tab bar) shows where it sits.
      await Bun.write(file.replace(".png", "-screen.png"), Buffer.from((await tab.call("Page.captureScreenshot", { format: "png" })).data, "base64"));
      console.log(file, tab.noise.join(" | "));
      await tab.close();
    }
  chrome.stop(); srv.stop();
}
