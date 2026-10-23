// `.assetsignore` as the dev host, the desktop binary and Cloudflare read it. Imports nothing.

/** `.assetsignore` (gitignore syntax) as a test on a path relative to the assets dir. */
export function assetIgnore(text: string): (rel: string) => boolean {
  const rules = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const negate = l.startsWith("!");
    let p = negate ? l.slice(1) : l;
    const dirOnly = p.endsWith("/");
    if (dirOnly) p = p.slice(0, -1);
    // A pattern with a slash (other than a trailing one) is anchored at the root; one without matches at any depth.
    const anchored = p.includes("/");
    p = p.replace(/^\//, "");
    const body = p.split(/(\*\*\/?|\*|\?)/).map((t) =>
      t === "**/" ? "(?:.*/)?" : t === "**" ? ".*" : t === "*" ? "[^/]*" : t === "?" ? "[^/]" : t.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
    // A match on a directory covers everything under it.
    const re = new RegExp(`${anchored ? "^" : "(?:^|/)"}${body}${dirOnly ? "/" : "(?:$|/)"}`);
    return { negate, re };
  });
  return (rel) => {
    let out = false;
    for (const r of rules) if (r.re.test(rel)) out = !r.negate;
    return out;
  };
}
