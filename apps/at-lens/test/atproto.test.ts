import { describe, expect, test } from "bun:test";
import { parseQuery, type Fetcher } from "../src/edge/atproto.ts";
import { api } from "../src/edge/worker.ts";
import { decodeCommit } from "../src/jetstream.ts";
import { MAX_BYTES, MAX_GRAPHEMES, STATUS, statusRecord } from "../src/lexicon.ts";
import lexicon from "../public/lexicons/dev.rustybuns.lens.status.json";

const DID = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const doc = (handle: string, did = DID) => ({
  id: did,
  alsoKnownAs: [`at://${handle}`],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.net" }],
});

/** A fake network: each URL prefix answers with its body (an object as JSON, a string as text); anything else 404s. */
const net = (routes: Record<string, unknown>): Fetcher => async (url) => {
  const hit = Object.keys(routes).find((p) => url.startsWith(p));
  if (!hit) return new Response("no", { status: 404 });
  const b = routes[hit];
  return typeof b === "string" ? new Response(b) : Response.json(b);
};
const dns = (txt: string[]) => ({ Answer: txt.map((data) => ({ type: 16, data: `"${data}"` })) });
const pds = {
  "https://plc.directory/": doc("alice.example.net"),
  "https://pds.example.net/xrpc/com.atproto.repo.describeRepo": { collections: ["app.bsky.feed.post", "app.bsky.actor.profile"] },
  "https://pds.example.net/xrpc/com.atproto.repo.listRecords": { records: [{ uri: `at://${DID}/app.bsky.feed.post/3abc`, cid: "bafy", value: { text: "hi" } }] },
};
const get = async (path: string, f: Fetcher) => {
  const res = await api(new URL(`https://lens.test${path}`), f)!;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("the walk, handle to records", () => {
  test.each([
    ["DNS TXT", "@Alice.example.net", { "https://cloudflare-dns.com/": dns([`did=${DID}`]), ...pds }, 200, true, "dns"],
    ["the handle's own /.well-known", "alice.example.net", { "https://alice.example.net/.well-known/atproto-did": `${DID}\n`, ...pds }, 200, true, "https"],
    ["a DID, verified back through its handle", DID, { "https://cloudflare-dns.com/": dns([`did=${DID}`]), ...pds }, 200, true, "dns"],
    ["a DID whose handle points elsewhere", DID, { "https://cloudflare-dns.com/": dns(["did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"]), ...pds }, 200, false, null],
    ["a handle whose DID document claims another name", "mallory.example.net", { "https://cloudflare-dns.com/": dns([`did=${DID}`]), ...pds }, 200, false, null],
    ["two DIDs in DNS and nothing on the web", "alice.example.net", { "https://cloudflare-dns.com/": dns([`did=${DID}`, "did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"]), ...pds }, 404, null, null],
    ["a handle with no DID anywhere", "nobody.example.net", pds, 404, null, null],
    ["not a handle at all", "not a handle", pds, 404, null, null],
  ])("by %s", async (_, q, routes, status, verified, via) => {
    const r = await get(`/api/lookup?q=${encodeURIComponent(q)}`, net(routes));
    expect(r.status).toBe(status);
    if (status !== 200) return expect(typeof r.body.error).toBe("string");
    expect(r.body).toMatchObject({ did: DID, handle: "alice.example.net", verified, via, pds: "https://pds.example.net" });
    expect(r.body.collections).toEqual(["app.bsky.actor.profile", "app.bsky.feed.post"]);
  });

  test("a collection's records come from the DID's own data server; a bad collection name is a 404", async () => {
    const ok = await get(`/api/records?did=${DID}&collection=app.bsky.feed.post`, net(pds));
    expect(ok.status).toBe(200);
    expect(ok.body.records).toEqual([{ uri: `at://${DID}/app.bsky.feed.post/3abc`, cid: "bafy", value: { text: "hi" } }]);
    expect((await get(`/api/records?did=${DID}&collection=../../etc`, net(pds))).status).toBe(404);
  });

  test("a DID document naming a non-https data server is refused, not fetched", async () => {
    const asked: string[] = [];
    const bad = { ...doc("alice.example.net"), service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "http://10.0.0.1:8080" }] };
    const f = net({ "https://cloudflare-dns.com/": dns([`did=${DID}`]), "https://plc.directory/": bad });
    const r = await get(`/api/lookup?q=alice.example.net`, async (u, i) => (asked.push(u), f(u, i)));
    expect(r.status).toBe(404);
    expect(asked.some((u) => u.includes("10.0.0.1"))).toBe(false);
  });
});

test("queries: a handle is a domain, lower-cased; reserved TLDs and other DID methods are not", () => {
  expect(parseQuery(" @Alice.Bsky.Social ")).toEqual({ handle: "alice.bsky.social" });
  expect(parseQuery("did:web:example.com")).toEqual({ did: "did:web:example.com" });
  for (const q of ["localhost", "alice.local", "alice.test", "1.2.3.4", "did:key:z6Mk", "did:plc:short"]) expect(parseQuery(q)).toBeNull();
});

test("Jetstream frames: a commit decodes, identity events and junk drop", () => {
  const commit = { $type: "message", payload: { $type: "network.bsky.jetstream.subscribeEvents#commit", seq: 7, did: DID, operation: "create", collection: "app.bsky.feed.post", rkey: "3abc", record: { text: "hi" } } };
  expect(decodeCommit(commit)).toEqual({ seq: 7, did: DID, op: "create", collection: "app.bsky.feed.post", rkey: "3abc", record: { text: "hi" } });
  expect(decodeCommit({ $type: "message", payload: { $type: "network.bsky.jetstream.subscribeEvents#identity", seq: 8, did: DID } })).toBeNull();
  expect(decodeCommit({ payload: "nope" })).toBeNull();
});

describe("writing: our Lexicon and the OAuth client", () => {
  test("the client metadata is served at its own client_id and asks only to create our records", async () => {
    const r = await get("/client-metadata.json", net({}));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ client_id: "https://lens.test/client-metadata.json", redirect_uris: ["https://lens.test/"], dpop_bound_access_tokens: true, token_endpoint_auth_method: "none" });
    expect(r.body.scope).toBe(`atproto repo:${STATUS}?action=create`);
  });

  test("the OAuth client's handle lookups go through our own walk", async () => {
    const ok = await get("/xrpc/com.atproto.identity.resolveHandle?handle=Alice.example.net", net({ "https://cloudflare-dns.com/": dns([`did=${DID}`]) }));
    expect(ok).toEqual({ status: 200, body: { did: DID } });
    const no = await get("/xrpc/com.atproto.identity.resolveHandle?handle=nobody.example.net", net({}));
    expect(no.status).toBe(400);
    expect(no.body.error).toBe("InvalidRequest");
  });

  test.each([
    ["  shipping the lens  ", "shipping the lens"],
    ["", "Write something first."],
    ["x".repeat(MAX_GRAPHEMES + 1), `${MAX_GRAPHEMES} characters at most.`],
  ])("a status of %p", (text, want) => {
    const now = new Date("2026-10-28T12:00:00Z");
    const r = statusRecord(text, now);
    expect(r).toEqual("error" in r ? { error: want } : { $type: STATUS, text: want, createdAt: now.toISOString() });
  });

  test("the published Lexicon is the record the page writes", () => {
    expect(lexicon.id).toBe(STATUS);
    const rec = lexicon.defs.main.record;
    expect(rec.required.sort()).toEqual(Object.keys(statusRecord("hi")).filter((k) => k !== "$type").sort());
    expect([rec.properties.text.maxGraphemes, rec.properties.text.maxLength]).toEqual([MAX_GRAPHEMES, MAX_BYTES]);
  });
});
