// The page: ask the Worker for the walk (handle, DID, data server, collections), show each step, list a
// collection's newest records, and watch the account live on Jetstream. State is the URL (?q=, &c=), so a
// link opens the same view and an agent's browser can drive it. Signed in (src/signin.ts), your own repo's view
// gets a box that writes a dev.rustybuns.lens.status record, and the live feed shows it coming back from Jetstream.
import { esc } from "@rustybuns/util";
import { check, obj, opt, raw, str, bool, arr, nul } from "@rustybuns/util/guard";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { decodeCommit, gist, streamUrl, type Commit } from "./jetstream.ts";
import { MAX_GRAPHEMES, STATUS, statusRecord } from "./lexicon.ts";
import type { OAuthSession } from "./signin.ts";

// OAuth on a loopback host runs on 127.0.0.1: the authorization server sends you back there, and the sign-in's
// stored state belongs to one origin.
if (location.hostname === "localhost") location.replace(location.href.replace("//localhost", "//127.0.0.1"));

const $ = (id: string) => document.getElementById(id)!;
const walk = $("walk"), repo = $("repo"), live = $("live"), me = $("me");
const input = $("q") as HTMLInputElement;

const Lookup = obj({
  did: str(2048),
  handle: nul(str(253)),
  verified: bool(),
  via: nul(str(10)),
  pds: str(2048),
  collections: arr(str(317), 500, { drop: true }),
  doc: raw,
});
const Records = obj({ records: arr(obj({ uri: str(8192), cid: str(200), value: raw }), 100, { drop: true }) });
const Failed = obj({ error: opt(str(2000)) });

async function api<T>(path: string, guard: (v: unknown) => T): Promise<T> {
  const res = await fetch(path);
  const v: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(check(Failed, v)?.error ?? `${path} said ${res.status}`);
  const t = check(guard, v);
  if (!t) throw new Error(`${path} sent something this page doesn't know`);
  return t;
}

const step = (n: number, title: string, value: string, note = "") =>
  `<li><span class="n">${n}</span><div><b>${title}</b><code>${value}</code>${note ? `<small>${note}</small>` : ""}</div></li>`;

let stream: Link<never> | null = null;
let pulse: Link<never> | null = null;
/** The DID on screen, so the write box shows only on your own repo. */
let onScreen: string | null = null;

async function show(q: string, collection: string | null) {
  stream?.close(); pulse?.close(); stream = pulse = null;
  repo.innerHTML = live.innerHTML = "";
  onScreen = null;
  if (!q) { walk.innerHTML = ""; return; }
  input.value = q;
  walk.innerHTML = `<p class="wait">Walking from ${esc(q)}...</p>`;
  let l;
  try { l = await api(`/api/lookup?q=${encodeURIComponent(q)}`, Lookup); }
  catch (e) { walk.innerHTML = `<p class="err">${esc(e instanceof Error ? e.message : String(e))}</p>`; return; }

  const name = l.handle ?? l.did;
  walk.innerHTML = `<h2>The walk</h2><ol class="steps">${[
    step(1, "Handle", esc(l.handle ?? "none claimed"),
      l.handle ? (l.verified ? `verified both ways: the DID document claims it, and its ${l.via === "dns" ? "DNS TXT record <code>_atproto." + esc(l.handle) + "</code>" : "<code>/.well-known/atproto-did</code>"} points back` : "not verified: the handle doesn't resolve back to this DID, so don't trust the name") : ""),
    step(2, "DID", esc(l.did), l.did.startsWith("did:plc:") ? `a permanent ID, kept by <a href="https://plc.directory/${esc(l.did)}" target="_blank" rel="noreferrer">plc.directory</a>; the handle can change, this can't` : "did:web: the ID is the host's own <code>/.well-known/did.json</code>"),
    step(3, "Data server (PDS)", esc(new URL(l.pds).host), "named in the DID document; move servers and only this line changes"),
    step(4, "Repository", `${l.collections.length} collection${l.collections.length === 1 ? "" : "s"}`, "signed records, each typed by a Lexicon schema named like a reversed domain"),
  ].join("")}</ol><details><summary>DID document</summary><pre>${esc(JSON.stringify(l.doc, null, 2))}</pre></details>`;

  repo.innerHTML = `<h2>Collections</h2><div class="chips">${l.collections.map((c) =>
    `<a href="?q=${encodeURIComponent(q)}&c=${encodeURIComponent(c)}" class="chip${c === collection ? " on" : ""}">${esc(c)}</a>`).join("") || "<p>Nothing published yet.</p>"}</div><div id="records"></div>`;
  if (collection) void showRecords(l.did, collection);

  onScreen = l.did;
  live.innerHTML = `<div id="compose-slot"></div><h2>Live</h2><p class="state" id="mine-state">Connecting to Jetstream for ${esc(name)}...</p><ul class="feed" id="mine"></ul>${collection ? `
    <h2>${esc(collection)}, whole network</h2><p class="state"><b id="rate">0</b> per second</p><ul class="feed" id="all"></ul>` : ""}`;
  stream = watch([l.did], [], $("mine"), $("mine-state"), name);
  if (collection) pulse = watch([], [collection], $("all"), null, null);
  composer();
}

async function showRecords(did: string, collection: string) {
  const box = $("records");
  box.innerHTML = `<p class="wait">Reading ${esc(collection)}...</p>`;
  try {
    const r = await api(`/api/records?did=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}`, Records);
    box.innerHTML = `<h3>Newest ${r.records.length} in ${esc(collection)}</h3><ul class="records">${r.records.map((x) =>
      `<li><code>${esc(x.uri.split("/").pop() ?? "")}</code> ${esc(gist(x.value))}<details><summary>record</summary><pre>${esc(JSON.stringify(x.value, null, 2))}</pre></details></li>`).join("")}</ul>`;
  } catch (e) { box.innerHTML = `<p class="err">${esc(e instanceof Error ? e.message : String(e))}</p>`; }
}

const MAX_ROWS = 30, ROW_MS = 250;

/** One Jetstream subscription into a list; picks up from the last event it saw after a drop. */
function watch(dids: string[], collections: string[], list: HTMLElement, state: HTMLElement | null, name: string | null): Link<never> {
  let cursor = 0, count = 0, shown = 0;
  const rate = collections.length ? $("rate") : null;
  const tick = rate ? setInterval(() => { rate.textContent = String(count); count = 0; }, 1000) : 0;
  const link = connectSocket<Commit, never>(() => streamUrl({ dids, collections, cursor }), {
    decode: decodeCommit,
    onOpen: () => { if (state) state.textContent = `Watching ${name} on Jetstream. Post, like or follow from any app and it shows up here.`; },
    onMessage(c) {
      cursor = c.seq || cursor;
      count++;
      // A busy collection runs at hundreds a second: count them all, show a few.
      const now = performance.now();
      if (now - shown < ROW_MS) return;
      shown = now;
      const li = document.createElement("li");
      li.className = c.op;
      li.innerHTML = `<span class="op">${c.op}</span> <code>${esc(c.collection)}</code> ${esc(gist(c.record))}`;
      list.prepend(li);
      while (list.children.length > MAX_ROWS) list.lastElementChild!.remove();
    },
    onClose: ({ tries }) => {
      if (state) state.textContent = "Jetstream dropped; trying again...";
      return Math.min(30_000, 1000 * 2 ** tries);
    },
  });
  return { send: link.send, get open() { return link.open; }, close: (...a) => { clearInterval(tick); link.close(...a); } };
}

// Signing in. The OAuth client loads after the page, so reading never waits on it.
let session: OAuthSession | null = null;
const auth = import("./signin.ts");

function account(trouble = "") {
  me.innerHTML = session
    ? `<p>Signed in as <a href="?q=${encodeURIComponent(session.did)}&c=${STATUS}">${esc(session.did)}</a> <button type="button" id="signout" class="quiet">Sign out</button></p>`
    : `<form id="signin"><input id="handle" autocomplete="username" spellcheck="false" placeholder="your.handle" aria-label="Your handle" /><button type="submit" class="quiet">Sign in to write</button></form>
      <small>Asks your data server for one thing: creating <code>${STATUS}</code> records (<a href="/lexicons/${STATUS}.json" target="_blank">the Lexicon</a>). No posts, likes or follows.</small>${trouble ? `<p class="err">${esc(trouble)}</p>` : ""}`;
  composer();
}

/** The write box, on your own repo's view only. */
function composer() {
  const slot = document.getElementById("compose-slot");
  if (!slot) return;
  slot.innerHTML = session && session.did === onScreen
    ? `<h2>Write</h2><form id="compose"><input id="text" maxlength="${MAX_GRAPHEMES * 4}" placeholder="A status, into your own repo" aria-label="Status" /><button type="submit">Write</button></form><p class="state" id="wrote">It goes to your data server as a <code>${STATUS}</code> record, then back here off Jetstream.</p>`
    : "";
}

async function submit(form: HTMLFormElement) {
  const m = await auth;
  if (form.id === "signin") {
    const handle = ($("handle") as HTMLInputElement).value.trim().replace(/^@/, "");
    if (!handle) return;
    me.querySelector("small")!.textContent = `Off to ${handle}'s sign-in page...`;
    // The view to come back to rides along as the OAuth state.
    try { await m.signIn(handle, location.search); }
    catch (e) { me.querySelector("small")!.innerHTML = `<span class="err">${esc(e instanceof Error ? e.message : String(e))}</span>`; }
  } else if (form.id === "compose" && session) {
    const text = $("text") as HTMLInputElement, wrote = $("wrote");
    const record = statusRecord(text.value);
    if ("error" in record) { wrote.innerHTML = `<span class="err">${esc(record.error)}</span>`; return; }
    wrote.textContent = "Writing...";
    try {
      const r = await m.write(session, record);
      text.value = "";
      wrote.innerHTML = `Written: <code>${esc(r.uri)}</code>. Watch it arrive below.`;
    } catch (e) { wrote.innerHTML = `<span class="err">${esc(e instanceof Error ? e.message : String(e))}</span>`; }
  }
}

document.addEventListener("submit", (e) => {
  if (!(e.target instanceof HTMLFormElement) || e.target.id === "ask") return;
  e.preventDefault();
  void submit(e.target);
});
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element) || e.target.id !== "signout" || !session) return;
  const s = session;
  session = null;
  account();
  void s.signOut().catch(() => {});
});

const fromUrl = () => {
  const p = new URLSearchParams(location.search);
  void show(p.get("q") ?? "", p.get("c"));
};

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  history.pushState(null, "", `?q=${encodeURIComponent(input.value.trim())}`);
  fromUrl();
});
// Collection chips and the "try" links stay on the page: same view, new URL.
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  if (!a || a.origin !== location.origin || a.pathname !== location.pathname || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  history.pushState(null, "", a.search);
  fromUrl();
});
addEventListener("popstate", fromUrl);
account();
void auth.then((m) => m.restore()).then((r) => {
  session = r.session;
  account(r.error ? `Sign-in didn't work: ${r.error}` : "");
  // Back from the authorization server: land on the view you left, or signed in, your own repo with our collection open.
  if (r.back !== null) {
    history.replaceState(null, "", r.back || (r.session ? `?q=${encodeURIComponent(r.session.did)}&c=${STATUS}` : "/"));
    fromUrl();
  }
}).catch((e: unknown) => account(`Sign-in didn't work: ${e instanceof Error ? e.message : String(e)}`));
fromUrl();
