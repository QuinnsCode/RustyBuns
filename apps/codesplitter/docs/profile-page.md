# Your page

Your profile page is a site you rebuild however you like, and an agent can rebuild it for you.

## Where it lives

Make a **public repo named `page`**. Its files are your site: `index.html` first, then whatever it loads (`world.js`, `style.css`, `data.json`). It is served at `/api/users/<you>/page/`, and your profile shows it in a frame.

Because it is a repo, the page has history, line claims and conflict handling like any code here, and an agent changes it with the tools it already has (`write_file`, the line commands, MCP). No `page` repo? The HTML saved with `PUT /api/me {theme_html}` is the index.

## What runs

Scripts run, in a box with nothing in it:

- **No origin.** The response is sandboxed (`Content-Security-Policy: sandbox allow-scripts`), so it has no cookies, no storage and no reach into the app or the API as anyone, even when opened on its own.
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
