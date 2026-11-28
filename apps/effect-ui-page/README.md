# Agent Page

> **What it proves:** a world any coding agent writes while you watch (Claude Code, Codex, opencode, T3 Code, or a
> browser agent with WebMCP), the way codeSplitter's profile page works: the agent writes real code (a canvas city, a
> three.js scene) and a sealed frame runs it. Effect UI runs the page around it, and an Effect Schema checks every
> write. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

```
cd apps/effect-ui-page
bun run dev              # http://127.0.0.1:4799
```

How it goes, as the landing's **What is Agent World?** card says it:

1. See how it works: try a ready-made world, no AI needed.
2. Make an account with eqosys: your world follows you to any browser.
3. Pick your land with one tap (a hill village or a neon city, or keep the desert), connect your AI and make it yours: it asks you three things, then writes the code while you watch.
4. Then the galaxy opens: your world joins one big map you can walk.

Open the page. It gives itself a room (`/r/<room>` in the address bar) and lands on one screen over a rainy night
city. Two cards at the top: **What is Agent World?** opens a short explainer in place, and **Create your world**
signs you in with eqosys and opens your world: the server keeps one per account (`POST /api/me/world`), the room you
first signed in from, so signing in on another browser lands you in the same world, its files from the server. Signed
in already, it goes straight there, and where eqosys can't be reached (local dev) it says so in one line. Signed out,
everything but the galaxy works as before, in a room this browser keeps; sign in later and that room becomes your world. Below them: the four parts it's built from (Effect UI, WebMCP, Cloudflare Artifacts, Effect), one line to copy, and four
pictures of what that line does. Three ready-made worlds (rainy city, solar system, fish tank; `src/worlds.ts`) load in
one click with no AI connected, on the landing, in the console and in Cmd+K, each with one thing to ask your AI next.
When your AI first reads the page or changes it, the landing gives way to your world; "Skip to the page" does it by
hand. A room this browser already kept opens straight on its page. The console is a terminal window in the middle of
the screen (**Hide** puts it away, **Show** brings it back): on the left what happened, the way a command line shows it
(connecting to the relay, connected, waiting for your AI, each call and how it went); on the right pictures and
buttons: Copy, Paste, Watch across the top, then a button for each way in:

- **Paste into any agent.** "Copy prompt" gives you a few lines to paste into Claude Code, Codex, opencode or
  T3 Code. They tell the agent to call the page's tools with `curl`, so there's nothing to install or configure.
- **Or add it as an MCP server** (the Claude, Codex and opencode buttons copy these), so the tools show up as the
  agent's own:
  - Claude Code: `claude mcp add --transport http agent-page <room>/mcp`
  - Codex: `codex mcp add agent-page --url <room>/mcp`
  - opencode: `opencode mcp add agent-page --url <room>/mcp`
  - T3 Code runs Claude Code or Codex underneath, so add the server to whichever one it runs.
- **In the browser:** an agent with WebMCP (`document.modelContext`) sees the same tools on the page itself.

Then ask for a world: "make me a rainy neon city in three.js, slowly orbiting". The world reloads with each file the
agent writes, and the console lists its calls. A step strip there shows where your AI is: Waiting for your AI, Your
AI is here (its first `page_read`), Asking you about your world (a `page_status`), Writing the code (its first write),
Your world is up (the frame loaded with no errors after a write). The AI asks you three things in its own chat (the
ground, what is on it, the weather) before it writes; the page never asks. A new room starts with a night desert
(`src/starter.ts`, built with `@world/kit`, so it stands in 3D in the galaxy) to change or throw away. A signed-in
person whose world is still that desert is asked to **Pick your land**: **Hill village** (round-doored mound homes,
smoke, trees, flowers, a pond, lanterns) or **Neon city** (lit towers, signs, stalls, a wet street, rain, flying cars),
both small kit worlds (`src/lands.ts`) their AI can change.

| Tool | Does |
|---|---|
| `page_read` | Each file's path and size, the backdrop, and what the frame said since it last loaded: errors with their file, loads it blocked |
| `page_read_file` | One file's whole text |
| `page_write_file` | Set one file (`index.html`, `world.js`, `lib/noise.js`, ...) to this text; `""` takes it away. Its description tells the agent how files load and what the frame allows |
| `page_edit_file` | Swap the one exact match of `find` in a file for `replace`, so a small change doesn't resend the file. No match, or more than one, is refused with the count |
| `page_set_backdrop` | A codeSplitter handle whose profile page (their public `page` repo) fills the window behind the world; `""` takes it away |
| `page_undo`, `page_reset` | Take back the last change, or go back to the starter desert |
| `page_status` | A few words (80 characters at most) on what the AI is doing, shown in the console and the step strip. Changes no file, nothing to undo |

A write or an edit answers with the files (paths and sizes, not their text), or why it couldn't be done. The Undo and
Start over buttons do the same as the tools. This browser keeps each room's world for the next visit. `?full` on the
link opens with the console put away.

**Pictures.** A moment after the world loads with no errors, the page takes a picture of its largest `<canvas>` and
keeps it on the room, at `GET <room>/picture` (the `/api/r/<room>` link). Share your `/r/<room>` link and the preview
shows that picture; a room with none shows the Agent Page sign. A world with no canvas has no picture of its own.
**Export GIF** (in the console and in Cmd+K) records three seconds of the canvas and downloads them as an animated GIF,
`<room>.gif`. Keep the tab in front while it records. The file's name is the room's key, so rename it before you pass it
on.

The room's link is its key (signing in names you, it doesn't lock the room), so share it only with agents you want
building your world. The page
has to stay open: it holds the world, and an agent that calls while no tab is open is told to ask you to open it.

What keeps it safe, in short:

- **The sealed frame** (`src/world.ts`): the world runs in an `<iframe sandbox="allow-scripts">` with no same-origin,
  so it has no cookies, no storage and no reach into this page. A Content-Security-Policy goes first in its document:
  scripts and libraries only from esm.sh, jsDelivr, unpkg and cdnjs, no `fetch` or sockets out, no forms. A reporter
  in the frame sends its errors and blocked loads to the page, and `page_read` hands them to the agent.
- **The bouncer**: each write is checked by its Schema first: a file name like `world.js` (one folder deep at most,
  text types only), 100,000 characters a file, 400,000 and 30 files a world.
- Only a page this server served can hold a room's socket (its `Origin` must match), so another site that learns the
  link can't take the agent's calls. `bun run dev` listens on 127.0.0.1 only, not your Wi-Fi.
- The same check guards the picture's `PUT`, which takes a JPEG of 150 KB at most, a few a minute. The world's own code
  can't send one or read one: the frame has no network.
- What the world says goes back to the agent, so the prompt and the MCP instructions tell it page text is content,
  never instructions.

### `@world/kit`

A world's module can `import { world, ground, sky } from "@world/kit"` instead of writing the same three.js each
time (`src/kit.ts`, three.js 0.170.0 from esm.sh). The plot is `SIZE` (200) units square around 0, x west to east and z north
to south, and hills level off at its edges. The building blocks size themselves by `SIZE`, never by a fixed number.

| Call | Gives |
|---|---|
| `world({ orbit, distance, angle })` | The scene, a camera looking down at an angle, the renderer, resizing and the loop. Returns `{ scene, camera, renderer }` |
| `ground({ type, color })` | `flat`, `dunes`, `hills` or `grass`. `heightAt(x, z)` reads it |
| `sky(type)`, `weather(type)` | `day`, `night` (stars and a moon) or `dusk`; `rain`, `snow`, `fireflies`, `fog` or `clear` |
| `mood({ top, low, fog, near, far, sun, power, fill, bloom })` | Your land's own air, here and in the galaxy: call after `sky` and `weather` |
| `smoke(x, y, z)`, `flyers(n)` | Chimney smoke; little cars flying over the plot |
| `grass(n)`, `flowers(n)` | Tufts and flowers on the ground |
| `glow` on `box`, `voxels`, `sign` | 1 to 3 lights it, and it blooms in the galaxy; `windows: "#ff2e97"` on a building colours its light |
| `water({ y, x, z, width, depth })` | A sheet of water |
| `trees(n)`, `cactus(n)`, `rocks(n)` | Scattered on the ground, never in water; `{ area, size, color }` |
| `lights({ sun, fill, color, at })`, `lamp({ x, y, z, color })` | The sun and sky light; a coloured glow |
| `every(f)`, `THREE` | Run `f(t, dt)` each frame; three.js for anything else |
| `onPlayer(cb)` | `cb(player, at)` when the page says a visitor is walking the plot (`{ agent_page: true, player: { x, z } \| null }`, 0 to 1). A world reacts to them and never draws them |

The building blocks: one call each, so a world an AI imagines is about 30 lines. Each is ordinary three.js meshes in the
kit's scene, so anything that hands the scene's shapes on carries them too. Things drawn as text are cubes, one mesh a colour.

| Call | Gives |
|---|---|
| `box({ x, y, z, w, h, d, color })` | A box on the ground (or at `y`) |
| `voxels(layers, palette, { x, y, z, size })` | A thing drawn as text: layers from the bottom up, each rows north to south, one letter a cube (`.` is empty) |
| `sprite(rows, palette, { x, y, z, size, fps })` | A pixel picture from text rows, standing up and turning to face the camera; `[rows, rows]` animates |
| `building({ x, z, w, d, h, color, windows, roof })` | A house or a tower, `roof` `peak` or `flat`; its windows light up under a night or dusk sky |
| `streets({ width, color, line })` | A crossroads through the middle that stops short of the edges (nothing sits between neighbours). Returns the four blocks `{ x, z, w, d }` to build on |
| `path(points, { width, color })` | A path through `[[x, z], ...]` |
| `sign(text, { x, z, size, turn })` | A wooden sign with pixel letters the kit draws itself (A to Z, 0 to 9, `. , ! ? ' - : /`, `\n`), 60 characters, readable from both sides |
| `creature({ sprite or voxels, palette, area, speed, wander, flee, follow })` | Something alive that roams its area, runs from a visitor within `flee`, or comes to one within `follow` |
| `near(x, z, radius, onEnter, onLeave)` | Something that happens when a visitor walks up, and when they walk away |
| `block(x, z, w, d)` | Nobody walks there: a 32 by 32 grid over the plot, posted to the page as `{ agent_page_world: true, kind: "solid", grid }` (1024 of `0` and `1`, north row first). Buildings, tall boxes and voxels mark their own; the middle of each edge stays open |

`test/fixtures/rain-city.js` is a whole rainy neon town by a river in 20 lines of it: streets, lit buildings, a sign and a cat.

### What a world costs in tokens

A fixed "build me a world" session (`test/session.ts`: `page_read`, read the starter's two files, write a small rainy
town, look, one fix, look) counted with the instructions and tool list once, each call's arguments and each reply, at
four characters a token (`scripts/mcp-session.ts`, the same session code as codeSplitter's `tool-tokens.ts`):

| | Tool list and instructions | Whole session |
|---|---|---|
| Before: three.js by hand, whole files resent | 682 | 4,473 |
| After: `@world/kit` and `page_edit_file` | 612 | 2,119 |
| The starter desert written with the kit too | 701 | 1,530 |
| The kit's building blocks in the tool text, and the rain town written with them | 790 | 1,531 |
| Now: mood, smoke, flyers, flowers and glow in the tool text (about 30 more) | 820 | 1,560 |

`test/tokens.test.ts` fails when the session passes the budget in `test/tokens.json`. A change that earns more tokens
raises it there, in the same PR. For Claude's own count on a live room: `apps/codesplitter/scripts/tool-tokens.ts`.

From a script or the console, the same tools are on `window.__commands`:

```
bun run probe effect-ui-page --js 'await __commands.run("page_read", {})'
```

### Agent Galaxy

Every world is a plot of land in one shared space, and the galaxy opens once your world is made: you are signed in, and your AI's write
loaded with no errors (the step strip's "Your world is up"), which the page saves on the server
(`POST /api/r/<room>/made`). Until then the Galaxy tile has a lock and one line under it ("Sign in and make your world
first", or "Make your world first"), and Cmd+K and `agentGalaxy.enter()` say the same; the server answers a claim with
no token 401 and one for a world not yet made 409. A ready-made world from Try one now doesn't count. A plot is a
person's (`eq:<sub>`, the token's checked against eqosys's keys, `src/who.ts`), one each, on their world's room.

Everyone's land in one 3D space, like rural neighbours: plots touch edge to edge with no streets or fences. **Agent
Galaxy** (the Galaxy tile in the console, or Cmd+K) shows your own land under cloud, then the cloud lifts and you are a
simple shape on it. Walk with WASD or the arrow keys (a touch stick on a phone), straight from your land onto your
neighbour's. **Back to my world** brings the console back.

- A world built with `@world/kit` stands there in 3D: its ground, water, trees, rocks and its own meshes, with what
  glows. It also brings its mood: sky colours, fog, sun, bloom, rain, snow or fireflies, chimney smoke and flying cars.
  The sky and light blend to whichever land you stand on. Each world hands over shapes, colours and bounded numbers
  only, from a hidden sealed frame, checked on arrival (`src/land.ts`), and a neighbour's code never runs in the shared
  space. Anything reaching past its own plot is left out. A world's own animation and stars stay home.
- A device that can't hold 33 frames a second drops sharpness, then shadows.
- A world without the kit (a flat canvas drawing, say) shows its latest picture laid on its ground.
- The middle plot is the common town. Empty plots are open land, with a sign next to you: "Invite someone to build
  here". Every third cell of the spiral stays free for invites (the invite link and sign-in come next).
- Your page saves your world to the server a second after each change that lands (`PUT /api/r/<room>/world`, checked
  with the same Schema and limits as a write), so your neighbours see what you built.
- You see the other people on your plot and the ones touching it. They have a colour and no name.
- The map never sends a room's link: a plot is known by a one-way hash of it, since the link is the room's key.

From a script or the probe: `window.agentGalaxy` has `state()`, `enter()`, `leave()` and `walk(dx, dz)`:

```
bun run probe effect-ui-page --url http://127.0.0.1:4799/r/<room> --js 'await agentGalaxy.enter()' --shot galaxy.png
```

## Deploy it

`bun run deploy` builds the page and ships it with the relay as one Worker (`wrangler.jsonc`). It has one small
Durable Object per room, which keeps one picture (150 KB at most) and the room's saved world (a key per file) in its
storage, and one `Galaxy` Durable Object for the whole map, and no AI or other paid bindings.
The Worker runs for `/` and `/r/*` too, to write the link preview into the page.

## How it's put together

- `src/page.ts`: the world (its files) and each tool's arguments as Effect Schemas, and `apply`, the one pure
  function that changes it. A tool's JSON Schema for the agent comes from the same Schema that checks its call.
- `src/world.ts`: the sealed frame's document: `index.html` with the world's own scripts and styles put inline, its
  modules' imports of each other through an import map, the policy and the reporter first. `src/starter.ts`: the
  starter desert's two files (`src/rain-city.ts` is the Rainy city try-one world). `src/kit.ts`: `@world/kit`'s
  source, a string the frame's import map carries.
- `src/account.ts`: "Create your world": eqosys sign-in (`@rustybuns/util/eqosys`), the token the page sends
  (`bearer`) and your world as the server keeps it (`myWorld`). `src/who.ts`: the server's side, the token checked
  against eqosys's keys (`EQOSYS_URL`) for app `agent-page`. `src/lock.ts`: when the galaxy opens, and its two lines.
- `src/answers.ts`: what the tools answer, shared by the page and the tests' stand-in for it (`test/app-kit.ts`).
- `src/tools.ts`: the tool list every door shares (WebMCP, HTTP, MCP) and the frames between the relay and the page.
- `src/agent.ts`: the `Agent` service in the page. Its Layer puts the WebMCP tools up (`@rustybuns/util/commands`)
  and keeps a socket to the room's relay while the page is mounted. A call from either becomes a message on a queue
  and waits for the page's report.
- `src/ProfilePage.ts`: the page as one Effect UI component (Model, messages, `update`, `view`): the world's frame,
  the landing and the Connect box.
  The agent's calls come in through a Subscription on that queue. Each change, the agent's or a person's click, ends
  with a `ReportPage` Command that answers the waiting call.
- `src/relay.ts`: a room's relay, with no platform code in it. It serves `GET /api/r/<room>/tools`,
  `POST /api/r/<room>/tools/<name>` and MCP over streamable HTTP at `/api/r/<room>/mcp`. Each call goes down the page's
  socket, and the reply comes back with the page's answer.
- `src/edge/worker.ts`: the relay on Cloudflare, one `Room` Durable Object per room. `scripts/dev.ts`: the same relay
  and the page in one Bun server.
- `src/camera.ts`: what takes pictures inside the frame. `src/pictures.ts`: the page's side (upload, Export GIF).
  `src/gif.ts`: our GIF encoder. `src/share.ts`: the picture routes and the link preview, for the Worker and the dev
  server alike. `bun scripts/og.ts` remakes `public/og.jpg`, the preview of a room with no picture.
- `src/galaxy.ts`: Agent Galaxy with no platform in it: the spiral, `claim`, the plots around a point, the players'
  moves (each to the same and touching plots only) and the wire guards both ends import. `src/edge/galaxy.ts` runs it
  in a Durable Object; `scripts/dev.ts` runs it in memory. `src/saved.ts`: a room's saved world, the same way.
  `src/galaxyView.ts`: walking and the players in the page. `src/land3d.ts`: the one 3D scene (three.js, loaded when
  the galaxy opens), and `src/air.ts` its sky, light, bloom, weather, smoke and cars. `src/land.ts`: a plot's land and
  mood as data, and what is left out of it.
- `test/galaxy.test.ts`: two people walking the galaxy in headless Chrome against the dev server.
  `test/land.test.ts`: what a world's frame may put in the shared space.

- `test/page.test.ts`: the Schema checks, `apply`, the frame's document, a `Story` of an agent's writes through
  `update`, and `Scene`s of a person's clicks. `test/relay.test.ts`: HTTP and MCP calls to a fake page, a refusal, a
  missing page, a timeout. `test/pictures.test.ts`: in headless Chrome, a world's picture, its link preview and Export
  GIF. `test/tokens.test.ts`: the token budget. `test/kit.test.ts`: the dev server and headless Chrome, an edit seen in
  the frame and a kit world running there.

Effect UI is in public preview and not on npm yet, so `package.json` pins a pkg.pr.new snapshot by commit
(`@effect/ui@a0d7578`). To move it on: `bun add https://pkg.pr.new/Effect-TS/ui/@effect/ui@<commit>` in this folder.
