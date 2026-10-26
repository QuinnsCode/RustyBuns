# Your page

Your profile page is a site you rebuild however you like, and an agent can rebuild it for you.

## Your page is yours, the rest stays

Whatever you build, the profile around it keeps its repos, pulse, stamps, collections and city. They are all there until you take them off: **Edit page** has a checkbox for each, or `PUT /api/me {hidden: ["pulse", "city"]}` (any of `repos`, `pulse`, `stamps`, `collections`, `city`, `top8`). Visitors don't see a hidden box; you still do, dimmed, so you can put it back.

## Top 8

Eight slots: Mervin is always friend #1, then up to seven people. Until you pick, they are the people you follow, newest first; add or drop from the box, or `PUT /api/me {top8: ["ana", "bob"]}`. An empty slot is a sad face until you get social.

## Where it lives

Make a **public repo named `page`**. Its files are your site: `index.html` first, then whatever it loads (`world.js`, `style.css`, `data.json`). It is served at `/api/users/<you>/page/`, and your profile shows it in a frame.

Because it is a repo, the page has history, line claims and conflict handling like any code here, and an agent changes it with the tools it already has (`write_file`, the line commands, MCP). No `page` repo? The HTML saved with `PUT /api/me {theme_html}` is the index.

## Full page

The expand icon on the page's bar wipes the profile away (a circular view transition from the corner) so the page fills the window. On your own profile, Talk to your page floats over it so you can keep directing the agent. Esc or the corner button wipes back.

## Talk to it, and put it back

On your own profile, **Talk to your page** sends what you type to a coding agent working in your `page` repo (the same agents as the file page's Agent button, so one must be set up). Two buttons beside it put the page back: the clock to how every file stood an hour ago, the circular arrow to the starter world below. Both are ordinary edits (`POST /api/me/page/revert {to: "hour" | "default"}`), so the log keeps what they replaced.

## What runs

Scripts run, in a box with nothing in it:

- **No origin.** The response is sandboxed (`Content-Security-Policy: sandbox allow-scripts`), so it has no cookies, no storage and no reach into the app or the API as anyone, even when opened on its own.
- **Its own host (optional).** Set `PAGES_ORIGIN` (say `https://pages.example.com`, routed to the same Worker, and set at build time too so the app's `frame-src` allows it) and the app redirects page reads there. That host answers only `GET /api/users/:name/page/...`, with no sign-in, so a page script can never reach the app's cookies or API. Unset, pages stay on the app's origin behind the sandbox.
- **No network.** `connect-src 'self'`: it can fetch its own files, nothing else. Forms go nowhere.
- **Libraries** load from `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com` or `esm.sh`; pin a version. Images, fonts and media may come from any `https:` host.
- **Public data only.** The page can read `JSON.parse(document.getElementById("profile").textContent)`: `{name, bio, repos}`, as a signed-out visitor sees it.
- **Text files only** (html, js, css, json, svg, txt, glsl). A model or texture goes in as a `data:` URI or an `https:` image.

## A three.js world

`index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#111}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script>
<script type="module" src="world.js"></script>
```

`world.js`:

```js
import * as THREE from "three";
const { name, repos } = JSON.parse(document.getElementById("profile").textContent);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4, 10);
scene.add(new THREE.HemisphereLight(0xffffff, 0x222244, 2));
// A tower per public repo.
const towers = repos.map((r, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + (r.length % 5), 1), new THREE.MeshStandardMaterial({ color: 0xff6a00 }));
  m.position.x = (i - repos.length / 2) * 2;
  scene.add(m);
  return m;
});
renderer.setAnimationLoop((t) => { towers.forEach((m, i) => (m.rotation.y = t / 1000 + i)); renderer.render(scene, camera); });
```
