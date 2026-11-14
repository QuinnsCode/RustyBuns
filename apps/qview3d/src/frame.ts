// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// GET /v1/frame?org=<org>&product=<product>: the widget alone on a bare page, for a site builder that strips a
// pasted <script> but keeps an <iframe>. The page around it hears the widget through postMessage:
//
//   frame -> page   { source: "qview3d", type: "qview:ready" | "qview:change" | "qview:snapshot" | "qview:saved" | "qview:error", detail }
//   page -> frame   { source: "qview3d", type: "save" | "snapshot" }   (answered by qview:saved / qview:snapshot, or qview:error)
//
// Only the org's own sites may frame it (frame-ancestors) or talk to it: the frame posts to its parent's origin only
// when that origin is one of the org's, and takes commands only from there.
import { esc } from "@rustybuns/util";
import type { Org } from "./api.ts";

/** The script on the frame page. It is a function so it is checked like the rest of the code, then served as its source. */
function relay(allowed: string[]) {
  const el = document.querySelector("qview-3d")!;
  // The page that framed us: the browser's own word where it gives one (Chromium, Safari), else the referrer.
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  let parentOrigin = ancestors?.[0] ?? "";
  if (!parentOrigin && document.referrer) try { parentOrigin = new URL(document.referrer).origin; } catch { /* no referrer */ }
  const ok = parent !== window && !!parentOrigin && (allowed.includes("*") || allowed.includes(parentOrigin));
  if (!ok) return;
  const post = (type: string, detail: unknown) => parent.postMessage({ source: "qview3d", type, detail }, parentOrigin);
  for (const type of ["qview:ready", "qview:change", "qview:snapshot", "qview:saved", "qview:error"]) {
    el.addEventListener(type, (e) => {
      const d = (e as CustomEvent).detail;
      post(type, type === "qview:error" ? { error: d?.error instanceof Error ? d.error.message : String(d?.error) } : d);
    });
  }
  addEventListener("message", (e: MessageEvent) => {
    if (e.origin !== parentOrigin || e.source !== parent || e.data?.source !== "qview3d") return;
    const q = el as HTMLElement & { save(): Promise<unknown>; snapshot(): Promise<unknown> };
    if (e.data.type === "save") q.save().catch(() => {});
    if (e.data.type === "snapshot") q.snapshot().catch(() => {});
  });
}

export function framePage(org: string, product: string, settings: Org): Response {
  // org.json may have been written by hand: only plain origins go into a header.
  const origins = settings.origins.filter((o) => /^(\*|https?:\/\/[^/\s;,']+)$/.test(o));
  const html = `<!doctype html>
<!-- Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0. -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QView3D</title>
<script type="module" src="/v1/qview3d.js"></script>
<style>html, body { margin: 0; height: 100%; background: transparent; } qview-3d { height: 100%; }</style>
</head>
<body>
<qview-3d org="${esc(org)}" product="${esc(product)}"></qview-3d>
<script type="module">(${relay.toString()})(${JSON.stringify(origins).replace(/</g, "\\u003c")});</script>
</body>
</html>`;
  const ancestors = origins.includes("*") ? "*" : origins.join(" ") || "'none'";
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "content-security-policy": `frame-ancestors ${ancestors}`,
    },
  });
}
