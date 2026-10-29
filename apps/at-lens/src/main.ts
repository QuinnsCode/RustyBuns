// The page: ask the Worker for the walk (handle, DID, data server, collections), show each step, list a
// collection's newest records, and watch the account live on Jetstream. State is the URL (?q=, &c=), so a
// link opens the same view and an agent's browser can drive it.
import { esc } from "@rustybuns/util";
import { check, obj, opt, raw, str, bool, arr, nul } from "@rustybuns/util/guard";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { decodeCommit, gist, streamUrl, type Commit } from "./jetstream.ts";

const $ = (id: string) => document.getElementById(id)!;
const walk = $("walk"), repo = $("repo"), live = $("live");
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

async function show(q: string, collection: string | null) {
  stream?.close(); pulse?.close(); stream = pulse = null;
  repo.innerHTML = live.innerHTML = "";
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

  live.innerHTML = `<h2>Live</h2><p class="state" id="mine-state">Connecting to Jetstream for ${esc(name)}...</p><ul class="feed" id="mine"></ul>${collection ? `
    <h2>${esc(collection)}, whole network</h2><p class="state"><b id="rate">0</b> per second</p><ul class="feed" id="all"></ul>` : ""}`;
  stream = watch([l.did], [], $("mine"), $("mine-state"), name);
  if (collection) pulse = watch([], [collection], $("all"), null, null);
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
fromUrl();
