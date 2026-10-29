import { NAME } from "../env.ts";

// Ink on paper with one teal accent; dark mode swaps them. Inline: a few small pages, no client script, no asset to fetch.
const CSS = `
:root{--bg:#f6f5f1;--fg:#16181d;--mut:#666b75;--card:#fff;--line:#dcdad3;--acc:#0f766e;--bad:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#ecebe6;--mut:#9aa0aa;--card:#171a1f;--line:#2a2e35;--acc:#5eead4;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:56rem;margin:0 auto;padding:1.5rem 1rem 4rem}h1{font-size:1.4rem;margin:0}h2{font-size:1rem;margin:1.5rem 0 .5rem}
.card h2{margin-top:0}.card p input{width:100%}a{color:var(--acc)}
header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.75rem}
.mut{color:var(--mut)}.bad{color:var(--bad)}
input,select,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:.45rem .7rem;max-width:100%}
button{cursor:pointer;background:var(--acc);color:var(--bg);border-color:var(--acc)}button.ghost{background:none;color:var(--fg);border-color:var(--line)}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}form{margin:0}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.5rem .4rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:500}
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
