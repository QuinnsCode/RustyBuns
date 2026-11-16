// The page: draws the world (game.ts), reads the pointer and arrow keys, and holds the menu with the eqosys account chip
// and the Qollab party. `window.starterGame` is the harness: `state()` says what is on screen, so an agent (bun run probe)
// asks the game instead of reading screenshots. Keep it in step when the game grows.
import { H, W, newWorld, start, step, type World } from "./game.ts";
import { accountChip, canSignIn, finishSignIn, login, party, type PartyMember } from "./eqosys.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage"), ctx = canvas.getContext("2d")!;
canvas.width = W; canvas.height = H;

const world: World = newWorld(Date.now() >>> 0);
let aim = W / 2;
const keys = new Set<string>();

/** What the party says: its code, who is in, and the room and seat once the host starts. */
const crew = { code: "", members: [] as PartyMember[], room: "", seat: -1, note: "" };

// Input: the pointer steers, and so do the arrow keys.
canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); aim = ((e.clientX - r.left) / r.width) * W; });
document.addEventListener("keydown", (e) => keys.add(e.key));
document.addEventListener("keyup", (e) => keys.delete(e.key));

function play() { start(world); aim = W / 2; menu(); }

function menu() {
  $("menu").hidden = world.phase === "play";
  $("title").textContent = world.phase === "over" ? `Score ${world.score}` : "Starter Game";
  $("play").textContent = world.phase === "over" ? "Again" : "Play";
  $("crew").textContent = crew.members.map((m) => `${m.name}${m.host ? " (host)" : ""}`).join(", ");
  $("code").textContent = crew.code ? `Party ${crew.code}${crew.room ? `, seat ${crew.seat + 1}` : ""}` : "";
  $("note").textContent = crew.note;
  // Only the host's Start counts: the party answers anyone else's with a refusal, shown in the note.
  $("start").hidden = !crew.code || !!crew.room;
}

function draw() {
  ctx.fillStyle = "#101826"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffd166";
  for (const s of world.stars) { ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#4cc9f0"; ctx.fillRect(world.x - 35, H - 32, 70, 14);
  ctx.fillStyle = "#e6edf3"; ctx.font = "16px system-ui"; ctx.fillText(String(world.score), 12, 24);
  ctx.fillStyle = "#f4a261";
  for (let i = 0; i < world.lives; i++) ctx.fillRect(W - 24 - i * 18, 12, 12, 12);
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (keys.has("ArrowLeft")) aim = world.x - 60;
  if (keys.has("ArrowRight")) aim = world.x + 60;
  const was = world.phase;
  step(world, dt, aim);
  if (was !== world.phase) menu();
  draw();
  requestAnimationFrame(frame);
}

// The party: make one (its code to hand out) or join one by code; the host's Start seats everyone.
function wireParty() {
  const p = party();
  p.onMembers((m) => { crew.members = m; menu(); });
  p.onStart((s) => { crew.room = s.room; crew.seat = s.seat; play(); });
  p.onGone((why) => { crew.note = why; crew.code = ""; crew.members = []; menu(); });
  p.onRefused((why) => { crew.note = why; menu(); });
  $("make").addEventListener("click", async () => {
    const code = await p.make();
    if (!code) { crew.note = login() ? "eqosys didn't make a party just now." : "Sign in to make a party."; return menu(); }
    crew.code = code; p.join(code); menu();
  });
  $<HTMLFormElement>("join").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $<HTMLInputElement>("joincode").value.trim().toUpperCase();
    if (code) { crew.code = code; p.join(code); menu(); }
  });
  $("start").addEventListener("click", () => p.start());
}

async function boot() {
  const back = await finishSignIn();
  if (back?.error) crew.note = back.error;
  accountChip($("account"), { onSignIn: () => menu(), onSignOut: () => menu() });
  $("party").hidden = !canSignIn();
  wireParty();
  $("play").addEventListener("click", play);
  menu();
  requestAnimationFrame(frame);
}

declare global { interface Window { starterGame: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): what is on screen, and the moves a test or an agent makes. */
const harness = {
  state: () => ({
    phase: world.phase, score: world.score, lives: world.lives, t: Math.round(world.t * 10) / 10, x: Math.round(world.x), stars: world.stars.length,
    signedIn: !!login(), party: crew.code ? { code: crew.code, members: crew.members.length, room: crew.room || null, seat: crew.seat >= 0 ? crew.seat : null } : null,
  }),
  start: () => play(),
  /** Steer the basket to `x` (0..400). */
  aim: (x: number) => { aim = x; },
};
window.starterGame = harness;

void boot();
