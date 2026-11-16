// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// GET /v1/embed.md (and /llms.txt): how to put QView3D on a page, written for a coding agent. Someone tells their
// Claude "add the 3D customiser from <host>/v1/embed.md to my product page" and it has everything: the two lines
// with this host filled in, what to change, how to check it worked, and the license. `?org=&product=` (a sandbox's page
// links it so) fills in that org and product in place of the demo's.

/** The guide, its tags naming `pick`'s org and product (the public demo's when unset). */
export function embedGuide(origin: string, pick?: { org: string; product: string }): string {
  const org = pick?.org ?? "demo", cap = pick?.product ?? "field-cap", tee = pick?.product ?? "crew-tee";
  const theirs = pick ? `
- \`org="${org}"\` is the person's own test shop (a sandbox QNTBR handed them), and \`product="${tee}"\` the product
  they set up in it. Any page may embed it, Save works, and it ends on the date its sandbox page shows. Use these
  two values; the demo products below are only for comparison.` : "";
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
<qview-3d org="${org}" product="${cap}"></qview-3d>
\`\`\`
${theirs}
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
  <qview-3d name="design" org="${org}" product="${tee}"></qview-3d>
  <input type="hidden" name="product" value="${tee}" />
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
<iframe src="${origin}/v1/frame?org=${org}&product=${tee}" title="Customise it in 3D"
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

## 9. Wire it to the shop's own tools: webhooks, both ways (optional)

This is server code, for a shop with an org of its own (not the demo). It needs the org's script key: the shop's
owner makes one on ${origin}/orgs.html (New script key) and keeps it in a server secret, never in page code.

**Out: QView3D tells the shop's server.** On ${origin}/orgs.html under Webhooks, the shop adds its URL (https) and
copies the signing secret, shown once. Or by script:

\`\`\`sh
curl -X POST ${origin}/api/orgs/<org>/hooks -H "authorization: Bearer <script key>" \\
  -H "content-type: application/json" -d '{"url":"https://shop.example/qview3d-hook"}'
# -> {"id":"…","secret":"whsec_…"}   GET .../hooks lists them and the last 20 deliveries; DELETE .../hooks/<id> removes one
\`\`\`

Each event is a POST with this JSON body:

\`\`\`json
{ "id": "<delivery id>", "type": "design.saved" | "order.ready" | "test", "org": "<org>", "created": <ms since 1970>,
  "data": { "design": "<24 hex>", "url": "${origin}/r/…", "model": "cap", "product": "<product id>" } }
\`\`\`

\`order.ready\` carries \`data.order\` (the store's order id) and \`data.lines\`: each \`{ design, qty, print, sheets, skipped }\`,
where \`sheets\` is a print file per zone (\`zone\`, size in \`cm\` and \`px\` at 300 dpi, and \`layers\`, bottom first: each one's \`at\`, where it sits, and
\`original\`, the print source: fetch it with the script key) and \`print\` is the same plan's own link.

Check every call before trusting it. The header is \`QView3D-Signature: t=<unix seconds>,v1=<hex>\`, where the hex is
the HMAC-SHA256 of \`<t>.<raw body>\` under the secret. Use the raw body, before any JSON parsing:

\`\`\`js
async function fromQView3D(req, secret) {
  const body = await req.text();
  const head = req.headers.get("QView3D-Signature") ?? "";
  const t = Number(head.match(/t=(\\d+)/)?.[1]), v1 = head.match(/v1=([0-9a-f]{64})/)?.[1];
  if (!v1 || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = new Uint8Array(v1.match(/../g).map((h) => parseInt(h, 16)));
  return (await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(\`\${t}.\${body}\`))) ? JSON.parse(body) : null;
}
\`\`\`

Answer 2xx quickly. Anything else, or no answer in 10 s, is tried again after 1 min, 5 min, 30 min, 2 h and 12 h
(the same body, signed afresh), then marked failed in the log. \`QView3D-Delivery\` names the delivery, so a receiver
can drop one it has already handled. The Send test button on ${origin}/orgs.html sends a \`test\` event.

**In: the store tells QView3D about an order.** When an order with saved designs comes in (the design id is the cart
line's \`design\` field from section 4), the shop's server posts it:

\`\`\`sh
curl -X POST ${origin}/api/orgs/<org>/orders -H "authorization: Bearer <script key>" \\
  -H "content-type: application/json" -d '{"id":"#1001","lines":[{"design":"<24 hex>","qty":2}]}'
\`\`\`

It answers \`201\` with the order and its lines' print files, and sends \`order.ready\` to the webhooks. Posting the same
order id again answers it as recorded (\`"fresh": false\`) and sends nothing, so a store's own retries are safe.
`;
}
