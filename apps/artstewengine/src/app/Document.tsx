import { NAME } from "../env.ts";

// Warm cream and navy, dark mode swaps them. Inline: three small pages, no client script, no asset to fetch.
const CSS = `
:root{--bg:#f4eee2;--fg:#0b1f3a;--mut:#5b6b80;--card:#fbf7ee;--line:#d9d0bd;--sky:#7cc4ff;--bad:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#05030a;--fg:#f4eee2;--mut:#9a93a8;--card:#120c1e;--line:#2a2038;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:56rem;margin:0 auto;padding:1.5rem 1rem 4rem}h1{font-size:1.4rem;margin:0}h2{font-size:1rem;margin:2rem 0 .5rem}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:.75rem}.stats b{display:block;font-size:1.6rem}
.mut{color:var(--mut)}.bad{color:var(--bad)}code{font:13px ui-monospace,monospace;word-break:break-all}
input,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:.45rem .7rem}
button{cursor:pointer;background:var(--fg);color:var(--bg);border-color:var(--fg)}button.ghost{background:none;color:var(--fg);border-color:var(--line)}
form.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}form{margin:0}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.5rem .4rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:500}
.bars{display:flex;align-items:flex-end;gap:2px;height:3rem}.bars i{flex:1;background:var(--sky);min-height:1px;border-radius:2px 2px 0 0}.bars i.no{background:var(--bad)}
`;

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <meta name="color-scheme" content="light dark" />
      <title>{NAME}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body><main>{children}</main></body>
  </html>
);
