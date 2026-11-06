// Renders the super admin's Scale tab to an HTML file with a stand-in admin, to look at it without signing in.
// bun scripts/scale-preview.tsx out.html [query]
import { renderToStaticMarkup } from "react-dom/server";
import { Document } from "../src/app/Document.tsx";
import { Home } from "../src/app/pages.tsx";
import { loadOf } from "../src/scale.ts";
import type { Me } from "../src/auth.ts";

const [out = "scale.html", q = ""] = process.argv.slice(2);
const me: Me = { id: "1", email: "boss@example.com", name: "Boss" };
const html = renderToStaticMarkup(
  <Document><Home counts={new Map()} t0={Date.now()} me={me} mine={undefined} hub={null} everyone={[]} unlocks={new Map()} tab="scale" scale={loadOf(new URLSearchParams(q))} /></Document>,
);
await Bun.write(out, `<!doctype html>${html}`);
console.log(out);
