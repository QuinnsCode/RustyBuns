// Browser Run off the edge: there's no browser here, so env.BROWSER is there (an app that checks for it
// still loads) and answers the two Quick Actions a plain fetch can: `content` (the page's HTML, as served:
// no script runs) and `links` (the hrefs in that HTML). Screenshots, PDFs, markdown, scrape, JSON and the
// CDP `fetch` fail with an error that says they run only on Cloudflare.
//
// `browser: "kitesurf"` picks Cloudflare's stateless agent browser on the edge; the binding refuses any
// other engine name, and so does this one, so a typo fails here first.

type Options = { url?: unknown; html?: unknown; browser?: unknown };

export class LocalBrowser {
  constructor(readonly binding = "BROWSER") {}
  private no(what: string): never {
    throw new Error(`Browser Run (${this.binding}): ${what} isn't available on the desktop; it runs only on Cloudflare`);
  }
  /** The HTML a Quick Action reads: `html` as given, or `url` fetched. */
  private async page(o: Options): Promise<{ html: string; base: string }> {
    if (typeof o.html === "string") return { html: o.html, base: "about:blank" };
    if (typeof o.url !== "string") throw new Error(`Browser Run (${this.binding}): needs { url } or { html }`);
    const r = await fetch(o.url, { redirect: "follow" });
    return { html: await r.text(), base: r.url || o.url };
  }
  async quickAction(action: string, options: unknown): Promise<Response> {
    const o: Options = typeof options === "object" && options !== null ? options : {};
    if (o.browser !== undefined && o.browser !== "kitesurf") throw new Error(`Browser Run (${this.binding}): Invalid input: expected "kitesurf"`);
    if (action === "content") return Response.json({ success: true, result: (await this.page(o)).html });
    if (action === "links") { const p = await this.page(o); return Response.json({ success: true, result: links(p.html, p.base) }); }
    this.no(`quickAction("${action}")`);
  }
  fetch(): never { this.no("fetch() (a CDP session)"); }
}

/** Every absolute http(s) href in the HTML, resolved against `base`, once each, in page order. */
export function links(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    try {
      const u = new URL((m[1] ?? m[2] ?? m[3] ?? "").replaceAll("&amp;", "&"), base);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.href);
    } catch { /* an href that isn't a URL is skipped, as the edge does */ }
  }
  return [...out];
}

export const browser = (binding?: string) => new LocalBrowser(binding);
