// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// GET /v1/embed.md (and /llms.txt): how to put QView3D on a page, written for a coding agent. Someone tells their
// Claude "add the 3D customiser from <host>/v1/embed.md to my product page" and it has everything: the two lines
// with this host filled in, what to change, how to check it worked, and the license.

export function embedGuide(origin: string): string {
  return `# QView3D: add a 3D product customiser to a page

You are a coding agent adding QView3D to someone's site. Shoppers see a 3D hat, add their own picture, drag it round
the front, size and turn it, pick a colour and spin the product. It is one ES module script and one custom element.
Nothing to install, no build step, no keys.

## License: tell the person first

QView3D is under the PolyForm Noncommercial License 1.0.0 (Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR)
(https://qntbr.com)). A hobby site, a demo, a school project or a nonprofit may use it freely. A shop that sells
with it needs a license: hello@qntbr.com. Say this to the person in one line before you finish, and leave the
notice comment at the top of the script alone.

## 1. Paste these two lines

Put the script once in the page's <head> (or before </body>), and the element where the product image goes:

\`\`\`html
<script type="module" src="${origin}/v1/qview3d.js"></script>
<qview-3d org="demo" product="field-cap"></qview-3d>
\`\`\`

- \`org="demo"\` is the public demo: it works on any page, right now. It keeps no files, so Save is refused there;
  customising and the snapshot download work. A real shop gets its own org (ask hello@qntbr.com), then sets
  \`org\` to it and \`product\` to one of its products.
- Demo products: \`field-cap\` (a six-panel cap), \`cuff-beanie\`, \`bucket-hat\`, \`crew-tee\` and \`pullover-hoodie\`
  (a top prints on its front, back and left sleeve: \`el.zone = "back"\` or \`el.addImage(file, "left-sleeve")\`).
- In React, Vue, Svelte and the like, it is a plain custom element: render \`<qview-3d>\` as you would any tag. In
  React 19 pass attributes as written; in older React set them with a ref. In TypeScript JSX you may need to declare
  the tag in \`JSX.IntrinsicElements\`.
- Static site, Shopify theme or a CMS: paste both lines into the product template or a custom HTML block.

## 2. Size it

It is a block element 520 px tall by default. Give it the space the product photo had:

\`\`\`css
qview-3d { height: min(70vh, 620px); }
\`\`\`

## 3. Make it match the site (optional)

Set any of these on the element (or a parent) to restyle the built-in controls, or use \`theme="dark"\`:

\`--qv-accent\` (marks), \`--qv-accent-ink\` (filled buttons and accent text: keep it dark enough for white text),
\`--qv-fg\`, \`--qv-bg\`, \`--qv-paper\` (control panels), \`--qv-line\`, \`--qv-radius\`, \`--qv-font\`.

\`qview-3d::part(toolbar | button | swatch | slider | models | hint | keys | stage | toast)\` reaches any piece.
\`<button slot="controls">\` children join the toolbar. \`controls="none"\` hides every built-in control so the page
drives it itself.

## 4. Hear what the shopper made (optional)

Events bubble from the element, each with a \`detail\`:

- \`qview:change\`: \`{ design }\` after each change. \`design\` holds the model, colour, the picture's place and the camera.
- \`qview:snapshot\`: \`{ blob, design }\`, a PNG of what they see.
- \`qview:saved\`: \`{ id, url, design }\` once saved to the org (not on the demo).
- \`qview:ready\` and \`qview:error\` (\`{ error }\`).

Methods: \`addImage(file)\`, \`place({ scale, rotation })\`, \`view("front" | "angle" | "side" | "back")\`,
\`snapshot()\`, \`save()\`, \`load(design)\`, and the \`model\` and \`color\` properties.

To put the design in a cart, call \`save()\` (a real org) and keep its \`id\` with the order line.

## 5. If the site has a Content-Security-Policy

Add \`${origin}\` to \`script-src\` and \`connect-src\`, and \`blob:\` to \`worker-src\`. Without \`worker-src blob:\` it
still works; photos are just prepared on the page's main thread.

## 6. Check it worked

Open the page and scroll to the element: a cap appears and spins when dragged. Click "Add your picture", pick an
image, and it lands on the front of the cap. In the console, \`document.querySelector("qview-3d").design\` returns
the settings. A live example of the whole thing: ${origin}/

It is keyboard-accessible already: Tab to the 3D view, then the arrows move the picture, + and - size it, [ and ]
turn it. Don't add handlers that swallow those keys on the element.
`;
}
