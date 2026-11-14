// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// GET /v1/embed.md (and /llms.txt): how to put QView3D on a page, written for a coding agent. Someone tells their
// Claude "add the 3D customiser from <host>/v1/embed.md to my product page" and it has everything: the two lines
// with this host filled in, what to change, how to check it worked, and the license.

export function embedGuide(origin: string): string {
  return `# QView3D: add a 3D product customiser to a page

You are a coding agent adding QView3D to someone's site. Shoppers see a 3D hat, shirt or hoodie, add their own picture,
drag it round, size and turn it, pick a colour and spin the product. It is one ES module script and one custom element,
served from the edge with a versioned path. Nothing to install, no build step, no keys.

There are two ways in. Use the first unless the site won't run a pasted script:

1. **The script tag** (sections 1 to 7): the element sits in the page and in its Add to cart form.
2. **An iframe** (section 8): for site builders that strip \`<script>\`. The page hears the widget through postMessage.

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
- Demo products: \`field-cap\` (a six-panel cap), \`cuff-beanie\`, \`bucket-hat\`, \`crew-tee\`, \`crew-sweater\`, \`pullover-hoodie\`, \`classic-tank\` and \`racerback-tank\`
  (a top prints on its front and back, and a sleeved one on its left sleeve: \`el.zone = "back"\` or
  \`el.addImage(file, "left-sleeve")\`; \`display="hanger"\` hangs a sleeved top on a hanger).
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

## 4. Put the design in the Add to cart form

Give the element a \`name\` and put it inside the product's \`<form>\`. It is a form field (a form-associated custom
element): when the shopper submits, it saves the design first (the pictures, a snapshot and the settings), then
submits the form again with two fields added, as hidden inputs would be:

- \`<name>\`: the saved design's id. Keep it with the order line; it is all whoever prints the order needs.
- \`<name>-url\`: the design's link (\`${origin}/r/...\`), which the shop's print-files page takes as well.

\`\`\`html
<form action="/cart/add" method="post">
  <qview-3d name="design" org="demo" product="crew-tee"></qview-3d>
  <input type="hidden" name="product" value="crew-tee" />
  <select name="size"><option>S</option><option selected>M</option><option>L</option></select>
  <button type="submit">Add to cart</button>
</form>
\`\`\`

- The page's own \`submit\` handlers only ever see the second submit, with the id in \`new FormData(form)\`.
- A change after a save (a new picture, a colour) clears the id, so the next submit saves again. \`el.value\` is the
  id while it still matches what the shopper sees, else \`""\`.
- If the save fails, the form is not submitted; the widget says why and fires \`qview:error\`.
- On \`org="demo"\` a public host keeps no files, so the save is refused there: test the form on the shop's own org.
- Not using a form (a cart drawer, a headless cart)? Call \`el.save()\` and send its \`id\` the shop's own way.

## 5. Hear what the shopper made (optional)

Events bubble from the element, each with a \`detail\`:

- \`qview:change\`: \`{ design }\` after each change. \`design\` holds the model, colour, the picture's place and the camera.
- \`qview:snapshot\`: \`{ blob, design }\`, a PNG of what they see.
- \`qview:saved\`: \`{ id, url, design }\` once saved to the org (not on the demo).
- \`qview:ready\` and \`qview:error\` (\`{ error }\`).

Methods: \`addImage(file)\`, \`place({ scale, rotation })\`, \`view("front" | "angle" | "side" | "back")\`,
\`snapshot()\`, \`save()\`, \`load(design)\`, the \`model\`, \`zone\` and \`color\` properties, and \`value\` (the saved design id, in a form).

## 6. If the site has a Content-Security-Policy

Add \`${origin}\` to \`script-src\` and \`connect-src\`, and \`blob:\` to \`worker-src\`. Without \`worker-src blob:\` it
still works; photos are just prepared on the page's main thread.

## 7. Check it worked

Open the page and scroll to the element: a cap appears and spins when dragged. Click "Add your picture", pick an
image, and it lands on the front of the cap. In the console, \`document.querySelector("qview-3d").design\` returns
the settings. A live example of the whole thing: ${origin}/

It is keyboard-accessible already: Tab to the 3D view, then the arrows move the picture, + and - size it, [ and ]
turn it. Don't add handlers that swallow those keys on the element.

## 8. When the site won't run scripts: an iframe

Some site builders keep an \`<iframe>\` but strip a pasted \`<script>\`. Then paste this instead of section 1:

\`\`\`html
<iframe src="${origin}/v1/frame?org=demo&product=crew-tee" title="Customise it in 3D"
  style="width:100%;height:560px;border:0" allow="clipboard-write"></iframe>
\`\`\`

- Only the org's own sites may frame it (\`frame-ancestors\` names them), and it talks only to a page on one of them.
  The demo org allows any.
- The frame posts each event to the page round it: \`{ source: "qview3d", type, detail }\`, \`type\` one of
  \`qview:ready\`, \`qview:change\`, \`qview:snapshot\` (\`detail.blob\` is the PNG), \`qview:saved\` (\`detail.id\`) and
  \`qview:error\` (\`detail.error\` is the message). Check that \`event.origin\` is \`${origin}\`.
- The page asks it to act with \`frame.contentWindow.postMessage({ source: "qview3d", type: "save" }, "${origin}")\`
  (or \`"snapshot"\`); the answer comes back as \`qview:saved\` or \`qview:snapshot\`.
- For a cart: on \`qview:saved\`, put \`detail.id\` in a hidden input of the product form, then submit it. A builder
  that allows no script at all still shows the customiser and its snapshot download, but can't carry the id.
`;
}
