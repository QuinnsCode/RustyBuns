// The service worker: what makes the page an app that opens with no signal. scripts/precache.ts compiles this file to
// dist/ui/sw.js after each build and puts the build's file list and a hash of them in front, as FILES and VERSION.
//
// Install fetches every file into a cache named for that hash; activate drops the caches of older builds. A request
// is answered from the cache first and from the network after, and a page load (any path: the app has one page) gets
// the cached "/". A deploy changes the hash, so sw.js changes, and the next launch installs the new build.

declare const VERSION: string;
declare const FILES: string[];

// The few service worker types this file uses (the WebWorker lib can't sit beside DOM in one tsconfig).
interface Extendable extends Event { waitUntil(p: Promise<unknown>): void }
interface Fetching extends Extendable { request: Request; respondWith(r: Promise<Response>): void }
interface Worker { skipWaiting(): Promise<void>; clients: { claim(): Promise<void> }; location: Location; addEventListener(t: string, f: (e: never) => void): void }
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- this file runs as a service worker, but the app is typed with the DOM's lib
const sw = self as unknown as Worker;

const PREFIX = "pocket-dice-";
const CACHE = PREFIX + VERSION;

sw.addEventListener("install", (e: Extendable) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (e: Extendable) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (e: Fetching) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== sw.location.origin) return;
  const key = req.mode === "navigate" ? "/" : req;
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(key, { ignoreSearch: true })) ?? fetch(req)));
});
