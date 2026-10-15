import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// End to end (real git, in-process D1), like tokens.test.ts.

/** ryan owns a private repo; sam has a handle; mail is caught in `sent`. */
async function app() {
  const sent: { to: string; subject: string; text: string }[] = [];
  const call = await boot({ GH_CLI: "off", EMAIL: { send: async (m: any) => { sent.push(m); } }, EMAIL_FROM: "hi@codesplitter.test" });
  const send = (user: string | null, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const u of ["ryan", "sam"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  const invite = async (body: unknown) => {
    const r = await send("ryan", "/api/repos/ryan/lab/invites", body);
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; token: string; link: string; kind: string; target: string | null; mailed?: boolean };
  };
  const crew = async () => ((await (await call("ryan", "/api/repos/ryan/lab")).json()) as { collaborators: string[]; invites: { id: string; token?: string; link?: string }[] });
  return { call, send, invite, crew, sent };
}

describe("invites", () => {
  test("a bare link shows the repo to anyone, and lets a person in once", async () => {
    const { call, send, invite, crew } = await app();
    const i = await invite({ note: "come fix the parser" });
    expect(i).toMatchObject({ kind: "link", target: null });
    expect(i.link).toBe(`http://codesplitter.local/invite/${i.token}`);
    // The link is shown once: the pending list has the id, never the token, and only its hash is stored (#648).
    const pending = (await crew()).invites;
    expect(pending.map((x) => x.id)).toEqual([i.id]);
    expect(pending[0]).not.toHaveProperty("token");
    expect(pending[0]).not.toHaveProperty("link");
    const row = await call.env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(i.id).first();
    expect(JSON.stringify(row)).not.toContain(i.token);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    // Its id isn't a key to it: only the one it's made out to by handle opens it by id.
    expect((await call(null, `/api/invites/${i.id}`)).status).toBe(404);
    expect((await send("sam", "/api/invites/claim", { invite: i.id, as: "person" })).status).toBe(404);
    // Signed out, the private repo is hidden, but the invite to it isn't.
    expect((await call(null, "/api/repos/ryan/lab")).status).toBe(404);
    expect(await (await call(null, `/api/invites/${i.token}`)).json()).toMatchObject({ owner: "ryan", repo: "lab", by: "ryan", note: "come fix the parser", doors: ["person", "agent"] });
    // The person door needs someone signed in.
    expect((await send(null, "/api/invites/claim", { invite: i.link, as: "person" })).status).toBe(401);
    const r = await send("sam", "/api/invites/claim", { invite: i.link, as: "person" });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ joined: "sam", door: "person" });
    const c = await crew();
    expect(c.collaborators).toEqual(["sam"]);
    expect(c.invites).toEqual([]);
    expect((await call("sam", "/api/repos/ryan/lab")).status).toBe(200);
    // Used up.
    const again = await call(null, `/api/invites/${i.token}`);
    expect(again.status).toBe(410);
    expect(((await again.json()) as any).error).toContain("@sam");
  });

  test("the agent door makes an agent its own handle and token, and the MCP lines", async () => {
    const { call, send, invite, crew } = await app();
    const i = await invite({});
    const r = await send(null, "/api/invites/claim", { invite: i.token, as: "agent", harness: "codex", name: "Linter" });
    expect(r.status).toBe(201);
    const a = (await r.json()) as any;
    expect(a.joined).toMatch(/^agent-linter-[a-z0-9]{4}$/);
    expect(a.token).toMatch(/^cst_/);
    expect(Object.keys(a.mcp).sort()).toEqual(["claude", "codex", "opencode", "pi"]);
    expect(a.mcp.claude).toContain(`Bearer ${a.token}`);
    expect((await crew()).collaborators).toEqual([a.joined]);
    // The token is the agent: it reads the private repo and its edits are blamed on it.
    const as = (url: string, init: RequestInit = {}) => call(null, url, { ...init, headers: { authorization: `Bearer ${a.token}` } });
    expect(((await (await as("/api/session")).json()) as any).user).toBe(a.joined);
    const doc = (await (await as("/api/repos/ryan/lab/do/file?path=a.ts")).json()) as { lines: { id: string; rev: number }[] };
    const edit = await as("/api/repos/ryan/lab/do/ops?path=a.ts", { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: doc.lines[0]!.id, base: doc.lines[0]!.rev, text: "uno" }] }) });
    expect(edit.status).toBe(200);
    const after = (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts")).json()) as { lines: { text: string; by: string }[] };
    expect(after.lines[0]).toMatchObject({ text: "uno", by: a.joined });
  });

  test("an agent with a token joins as itself, through MCP's claim_invite", async () => {
    const { call, send, invite, crew } = await app();
    const first = (await (await send(null, "/api/invites/claim", { invite: (await invite({})).token, as: "agent" })).json()) as any;
    expect(first.joined).toMatch(/^agent-guest-/);
    // A second repo's invite: the agent comes in as the handle it already has, with a token for that repo (its first is held to lab).
    await send("ryan", "/api/repos", { name: "lab2" });
    const second = (await (await send("ryan", "/api/repos/ryan/lab2/invites", {})).json()) as { link: string };
    const res = await call(null, "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "claim_invite", arguments: { body: { invite: second.link, as: "agent" } } } }) });
    const out = (await res.json()) as any;
    expect(out.result.isError).toBe(false);
    expect(JSON.parse(out.result.content[0].text)).toMatchObject({ joined: first.joined, door: "agent" });
    const lab2 = JSON.parse(out.result.content[0].text).token as string;
    expect(lab2).toMatch(/^cst_/);
    expect(((await (await call("ryan", "/api/repos/ryan/lab2")).json()) as any).collaborators).toEqual([first.joined]);
    const file = (token: string) => call(null, "/api/repos/ryan/lab2/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ path: `${token.slice(-6)}.txt`, content: "x" }) });
    expect((await file(first.token)).status).toBe(403);
    expect((await file(lab2)).status).toBe(201);
    // Already in lab: a claim there is turned away and leaves the invite pending.
    const third = await invite({});
    expect((await call(null, "/api/invites/claim", { method: "POST", headers: { authorization: `Bearer ${first.token}` }, body: JSON.stringify({ invite: third.token, as: "agent" }) })).status).toBe(409);
    expect((await crew()).invites.map((x) => x.id)).toEqual([third.id]);
  });

  test("an agent's token reaches its repo only, can't show private lines again, and goes when it leaves the crew (#645)", async () => {
    const { call, send, invite } = await app();
    const a = (await (await send(null, "/api/invites/claim", { invite: (await invite({})).token, as: "agent" })).json()) as any;
    const as = (url: string, body?: unknown, method = "POST") => call(null, url, { ...(body !== undefined && { method, body: JSON.stringify(body) }), headers: { authorization: `Bearer ${a.token}` } });
    // Another repo of ryan's it's in the crew of, without coming through an invite there: still out of reach.
    await send("ryan", "/api/repos", { name: "other" });
    await send("ryan", "/api/repos/ryan/other/collaborators", { name: a.joined });
    expect((await as("/api/repos/ryan/other/files", { path: "x.ts", content: "x" })).status).toBe(403);
    expect((await as("/api/repos", { name: "mine" })).status).toBe(403);
    expect((await as("/api/repos/ryan/lab/files", { path: "b.ts", content: "b" })).status).toBe(201);
    // It may hide lines, but showing them again is ryan's.
    const doc = (await (await as("/api/repos/ryan/lab/do/file?path=a.ts")).json()) as { lines: { id: string }[] };
    const lines = [doc.lines[0]!.id];
    expect((await as("/api/repos/ryan/lab/do/private?path=a.ts", { lines, private: true })).status).toBe(200);
    expect((await as("/api/repos/ryan/lab/do/private?path=a.ts", { lines, private: false })).status).toBe(403);
    expect(await (await call(null, "/api/repos/ryan/lab/do/private?path=a.ts", { headers: { authorization: `Bearer ${a.token}` } })).json()).toEqual(lines);
    expect((await send("ryan", "/api/repos/ryan/lab/do/private?path=a.ts", { lines, private: false })).status).toBe(200);
    // Out of the crew, its token for lab is gone too.
    expect((await call("ryan", `/api/repos/ryan/lab/collaborators/${a.joined}`, { method: "DELETE" })).status).toBe(200);
    expect((await as("/api/session")).status).toBe(401);
  });

  test("a handle invite is that person's alone, and never an agent's", async () => {
    const { call, send, invite } = await app();
    await send("mia", "/api/login", { name: "mia" });
    expect((await send("ryan", "/api/repos/ryan/lab/invites", { handle: "nobody-here" })).status).toBe(404);
    const i = await invite({ handle: "@sam" });
    expect(i).toMatchObject({ kind: "handle", target: "sam" });
    expect((await (await call(null, `/api/invites/${i.token}`)).json())).toMatchObject({ for: "sam", doors: ["person"] });
    expect((await send(null, "/api/invites/claim", { invite: i.token, as: "agent" })).status).toBe(403);
    expect((await send("mia", "/api/invites/claim", { invite: i.token, as: "person" })).status).toBe(403);
    // sam sees it waiting, by id (the link went to ryan, once), and opens and claims it by that.
    expect(((await (await call("sam", "/api/invites")).json()) as any[]).map((x) => x.id)).toEqual([i.id]);
    expect((await (await call("sam", `/api/invites/${i.id}`)).json())).toMatchObject({ for: "sam", owner: "ryan", repo: "lab" });
    expect((await call("mia", `/api/invites/${i.id}`)).status).toBe(404);
    expect((await send("mia", "/api/invites/claim", { invite: i.id, as: "person" })).status).toBe(404);
    expect((await send("sam", "/api/invites/claim", { invite: i.id, as: "person" })).status).toBe(201);
    expect((await send("ryan", "/api/repos/ryan/lab/invites", { handle: "sam" })).status).toBe(409);
  });

  test("an email invite goes out through the account mailer", async () => {
    const { invite, sent } = await app();
    const i = await invite({ email: "New.Person@Example.com", note: "bring snacks" });
    expect(i).toMatchObject({ kind: "email", target: "new.person@example.com", mailed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("new.person@example.com");
    expect(sent[0]!.subject).toContain("ryan/lab");
    expect(sent[0]!.text).toContain(i.link);
    expect(sent[0]!.text).toContain("bring snacks");
  });

  test("only the owner invites; invites expire and can be revoked", async () => {
    const { call, send, invite, crew } = await app();
    expect((await send("sam", "/api/repos/ryan/lab/invites", {})).status).toBe(404);   // can't even see it
    await send("ryan", "/api/repos", { name: "open" });
    expect((await send("sam", "/api/repos/ryan/open/invites", {})).status).toBe(403);
    expect((await send("ryan", "/api/repos/ryan/lab/invites", { days: 99 })).status).toBe(400);
    const gone = await invite({});
    expect((await send("ryan", `/api/repos/ryan/lab/invites/${gone.token}`, undefined, "DELETE")).status).toBe(404);   // by id, not the secret
    expect((await send("ryan", `/api/repos/ryan/lab/invites/${gone.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await call(null, `/api/invites/${gone.token}`)).status).toBe(404);
    const old = await invite({});
    await call.env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, old.id).run();
    expect((await send("sam", "/api/invites/claim", { invite: old.token, as: "person" })).status).toBe(410);
    expect((await crew()).invites).toEqual([]);
    // And the owner can take someone back out.
    await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
    expect((await send("ryan", "/api/repos/ryan/lab/collaborators/sam", undefined, "DELETE")).status).toBe(200);
    expect((await crew()).collaborators).toEqual([]);
  });

  test("/invite/:token sends a browser to the page, and tells an agent what to do", async () => {
    const { call, invite } = await app();
    const i = await invite({ note: "hi" });
    const browser = await call(null, `/invite/${i.token}`, { headers: { accept: "text/html,application/xhtml+xml" } });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe(`/#/i/${i.token}`);
    const agent = await call(null, `/invite/${i.token}`);
    const text = await agent.text();
    expect(agent.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("ryan/lab");
    expect(text).toContain("/api/invites/claim");
    expect(text).toContain("claim_invite");
    expect((await call(null, "/invite/csi_nope")).status).toBe(404);
  });
});
