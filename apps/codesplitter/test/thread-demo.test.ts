import { expect, setDefaultTimeout, test } from "bun:test";
import { local } from "./app-kit.ts";
import worker from "../src/worker.ts";
import { CREW, FILE, OWNER, REPO, scriptedAgent, seed, seedLive, signIn } from "../scripts/thread-demo.ts";

setDefaultTimeout(30_000);

/** Waits for `f`, failing the test if it never comes. */
const until = async (f: () => boolean | Promise<boolean>) => {
  for (const end = performance.now() + 15_000; performance.now() < end;) { if (await f()) return; await Bun.sleep(20); }
  throw new Error("timed out waiting for " + f.toString());
};

/** A page's socket as `who`: every frame it gets, the hello first. */
async function listen(call: any, who: string, url: string): Promise<any[]> {
  const ws = ((await call(who, url, { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
  for (const d of ws.queue.splice(0)) got.push(JSON.parse(d));
  ws.toBrowser = (d: string) => got.push(JSON.parse(d));
  return got;
}

test("the thread demo (#3742): florence signs in by link, talks to the scripted agent, drops a file, tells it from her own MCP, and its run comes pushed to the file", async () => {
  const call = await local({ GH_CLI: "off", AGENT_EXEC: scriptedAgent(FILE, { ms: 20 }), AGENT_REVIEW_MS: "0" });
  const { id, token, thread: link } = await seed(call);

  // The printed link signs her in as florence and lands on the thread; nobody else's name works.
  const signed = signIn(new Request("http://x/as/florence"), link);
  expect([signed.status, signed.headers.get("location"), signed.headers.get("set-cookie")]).toEqual([302, `/${link}`, "cs_user=florence; Path=/; SameSite=Lax"]);
  expect(signIn(new Request("http://x/as/eve"), link).status).toBe(404);

  const api = `/api/repos/${OWNER}/${REPO}`, thread = `${api}/agents/${id}/thread`;
  const file = ((await call(CREW, `${api}/do/ws?path=${encodeURIComponent(FILE)}`, { headers: { upgrade: "websocket" } })) as any).webSocket, pings: string[] = [];
  file.toBrowser = (d: string) => { if (JSON.parse(d).type === "runs") pings.push("runs"); };
  const got = await listen(call, CREW, `${thread}/ws`);
  const agentSaid = () => got.filter((m) => m.t === "msg" && m.message.kind === "agent").map((m) => m.message.text as string);
  await until(() => agentSaid().some((t) => t.startsWith("On it")));

  // She says something; the agent answers in the thread.
  await call(CREW, thread, { method: "POST", body: JSON.stringify({ text: "warmer, please" }) });
  await until(() => agentSaid().some((t) => t.includes('"warmer, please"')));

  // A screenshot dropped in: the agent has it in its folder.
  await call(CREW, `${thread}/files?name=shot.png&text=like+this`, { method: "POST", body: "PNG-ish", headers: { "content-type": "image/png" } });
  await until(() => agentSaid().some((t) => t.startsWith("Got .thread/")));
  expect(agentSaid()).toContainEqual(expect.stringMatching(/^Got \.thread\/\d+-shot\.png: 7 bytes/));

  // Her own Claude Code, through MCP with the printed token: tell_agent lands in the thread, as her.
  const rpc = await call(null, "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tell_agent", arguments: { owner: OWNER, repo: REPO, id: String(id), body: { text: "from my terminal: done" } } } }) });
  expect(rpc.status).toBe(200);
  await until(() => got.some((m) => m.t === "msg" && m.message.who === CREW && m.message.text === "from my terminal: done"));

  // "done" finishes it: its state comes pushed to the thread and the file page, and its edit is on the file.
  await until(() => got.some((m) => m.t === "run" && m.run.status === "done"));
  await until(() => pings.length >= 1);
  expect(pings.length).toBeGreaterThan(0);
  const doc = await (await call(CREW, `${api}/do/file?path=${encodeURIComponent(FILE)}`)).json() as { lines: { text: string }[] };
  expect(doc.lines.map((l) => l.text)).toContain("// @florence: warmer, please");
});

test("bring your own agent (#3742): the live seed's two links put Florence and his agent on the crew; his agent opens a thread, he talks, it answers, and the site runs nothing", async () => {
  let ran = 0;
  const call = await local({ GH_CLI: "off", AGENT_EXEC: async () => { ran++; return { code: 0, out: "" }; } });
  const site = Bun.serve({ port: 0, fetch: (req) => worker.fetch(req, call.env) });
  try {
    const send = (user: string | null, path: string, body?: unknown, auth?: string) =>
      call(user, path, { method: body === undefined ? "GET" : "POST", ...(body !== undefined && { body: JSON.stringify(body) }), ...(auth && { headers: { authorization: `Bearer ${auth}` } }) });
    await send("ryan", "/api/login", { name: "ryan" });
    const owner = ((await (await send("ryan", "/api/tokens", { label: "seed", scope: "admin" })).json()) as { token: string }).token;
    const s = await seedLive(`http://127.0.0.1:${site.port}`, owner);
    expect(s).toMatchObject({ owner: "ryan", repo: "florence-demo" });
    expect(s.brief).toContain("open_agent_thread on ryan/florence-demo");

    // Florence comes in by his link; his agent by the other, with a token of its own.
    await send("florence", "/api/login", { name: "florence" });
    expect((await send("florence", "/api/invites/claim", { invite: s.person, as: "person" })).status).toBe(201);
    const claimed = (await (await send(null, "/api/invites/claim", { invite: s.agent, as: "agent", harness: "claude" })).json()) as { joined: string; token: string };
    const bot = claimed.joined, tool = async (name: string, args: unknown) => {
      const r = await send(null, "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, claimed.token);
      const text = ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;
      return JSON.parse(text);
    };

    // His agent opens its thread; he says something there; it reads only what's new and answers as the agent.
    const opened = await tool("open_agent_thread", { owner: "ryan", repo: "florence-demo", body: { path: FILE, task: "make greet() friendlier" } });
    expect(opened).toMatchObject({ agent: bot, harness: "own", status: "running" });
    const at = { owner: "ryan", repo: "florence-demo", id: String(opened.id) }, thread = `/api/repos/ryan/florence-demo/agents/${opened.id}/thread`;
    const seen = (await tool("read_agent_thread", at)).last;
    expect(await (await send("florence", thread, { text: "warmer, please" })).json()).toMatchObject({ told: opened.id });
    const fresh = await tool("read_agent_thread", { ...at, after: String(seen) });
    expect(fresh.messages.map((m: { who: string; text: string }) => [m.who, m.text])).toEqual([["florence", "warmer, please"]]);
    expect(await tool("say_in_agent_thread", { ...at, body: { text: "warmer it is", as: "agent" } })).toMatchObject({ message: { who: bot, kind: "agent" } });

    // Only its own agent answers as it; @agent starts nothing; done closes it, and the site never ran a thing.
    expect((await send("florence", thread, { text: "me too", as: "agent" })).status).toBe(403);
    expect(await (await send("ryan", thread, { text: "@agent go" })).json()).not.toHaveProperty("started");
    expect(await tool("say_in_agent_thread", { ...at, body: { text: "done: greet() is warmer", done: true } })).toMatchObject({ done: true });
    const runs = (await (await send("florence", thread)).json()) as { runs: { status: string }[] };
    expect(runs.runs.map((r) => r.status)).toEqual(["done"]);
    expect(ran).toBe(0);
  } finally { site.stop(true); }
});
