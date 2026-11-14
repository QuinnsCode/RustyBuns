// The home page with a stand-in admin and stand-in data, to look at any tab without signing in (no secrets, no database).
// bun scripts/preview.tsx [port]   then open /?tab=studio, /?tab=scale&..., and so on. Forms post nowhere.
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Document } from "../src/app/Document.tsx";
import { Home, tabOf } from "../src/app/pages.tsx";
import { APPS } from "../src/apps.ts";
import { loadOf } from "../src/scale.ts";
import type { Me } from "../src/auth.ts";
import type { Studio } from "../src/studios.ts";

const me: Me = { id: "1", email: "boss@example.com", name: "Boss" };
const studios: Studio[] = [
  { id: "qntbr", name: "QNTBR", kind: "business", role: "owner", members: 3, space: null,
    people: [{ name: "Boss", email: "boss@example.com", role: "owner" }, { name: "Ada", email: "ada@example.com", role: "admin" }, { name: "Bo", email: "bo@example.com", role: "maker" }],
    apps: APPS.map((a, i) => ({ id: a.id, name: a.name, play: a.origins[0] ?? null, make: i % 3 ? null : "qntbr/" + a.id, ship: a.origins.length ? "live" : "not deployed", shipped: i === 0 ? { stage: "production", version: "0.0.1+abc1234", at: Date.now() - 3_600_000 } : null })) },
  { id: "ada", name: "Ada Works", kind: "team", role: "maker", members: 1, space: null, people: [{ name: "Ada", email: "ada@example.com", role: "owner" }], apps: [] },
];
const unlocks = new Map([[APPS[0]!.id, new Map([["first", Date.now()], ["second", Date.now()]])]]);

const server = Bun.serve({ port: Number(process.argv[2] ?? 0), hostname: "127.0.0.1", async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname !== "/") { const f = Bun.file(join(import.meta.dir, "../public", url.pathname)); return (await f.exists()) ? new Response(f) : new Response("", { status: 404 }); }
  const tab = tabOf(url.searchParams.get("tab"));
  const html = renderToStaticMarkup(<Document><Home counts={new Map()} t0={Date.now()} me={me} mine={undefined} hub={null} everyone={[]} unlocks={unlocks}
    tab={tab} studios={studios} scale={tab === "scale" ? loadOf(url.searchParams) : null} error={url.searchParams.get("e") ?? undefined} /></Document>);
  return new Response(`<!doctype html>${html}`, { headers: { "content-type": "text/html" } });
} });
console.log(`eqosys home preview: http://127.0.0.1:${server.port}/?tab=studio`);
