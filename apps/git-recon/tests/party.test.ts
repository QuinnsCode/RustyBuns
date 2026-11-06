// One journey through the running page: online, a signed-in player opens a party, a friend opens its link on a phone and
// readies up, the host starts, and both pages go into the battle room named for the party, the host as host and
// each with their eqosys token. A stand-in eqosys plays Qollab's party (apps/eqosys/src/party.ts); Chrome answers
// /__rb/info as the edge Worker does, so the page thinks it's online.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { newKey, peek, sign } from "@rustybuns/util/token";
import { chromePath, launchChrome, load, openTab, startVite, type Tab } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

const CODE = "PRTY7K";
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
type Who = { id: string; name: string; ready: boolean; host: boolean };
const members: Who[] = [];
const socks = new Set<Bun.ServerWebSocket<{ token: string }>>();
const tell = (m: object) => { for (const s of socks) s.send(JSON.stringify(m)); };
let EQOSYS = "";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, GET" };
const fake = Bun.serve<{ token: string }>({
  port: 0, hostname: "127.0.0.1",
  fetch(req, server) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (pathname === "/q/party" && req.method === "POST") return Response.json({ code: CODE }, { headers: cors });
    if (pathname === `/q/party/${CODE}`) {
      const token = (req.headers.get("sec-websocket-protocol") ?? "").split(",")[1]?.trim() ?? "";
      return server.upgrade(req, { data: { token }, headers: { "sec-websocket-protocol": "eqosys" } }) ? undefined : new Response("", { status: 400 });
    }
    return new Response("", { status: 404, headers: cors });
  },
  websocket: {
    open(ws) {
      socks.add(ws);
      const name = peek(ws.data.token)!.name;
      members.push({ id: name, name, ready: false, host: members.length === 0 });
      tell({ t: "members", members });
    },
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      const me = members.find((x) => x.name === peek(ws.data.token)!.name)!;
      if (m.t === "ready") me.ready = m.ready, tell({ t: "members", members });
      if (m.t === "start" && me.host) [...socks].forEach((s, seat) => s.send(JSON.stringify({ t: "start", room: CODE, seat })));
    },
    close(ws) { socks.delete(ws); },
  },
});
EQOSYS = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

const tokenFor = (name: string) => sign(signer, EQOSYS, { user: { id: `u_${name}`, email: `${name}@example.com`, name }, app: "git-recon", source: "git-recon", access: ["play"] });

/** A tab that's online (as the edge Worker says) and signed in as `name`, with the sockets it opens recorded. */
async function player(chrome: Awaited<ReturnType<typeof launchChrome>>, base: string, name: string, size: { w: number; h: number }, mobile: boolean) {
  const tab = await openTab(chrome.cdp, size, mobile, true);
  const sockets: string[] = [];
  chrome.cdp.on((m) => {
    if (m.sessionId !== tab.sessionId) return;
    if (m.method === "Network.webSocketCreated") sockets.push(m.params.url);
    if (m.method === "Fetch.requestPaused") void tab.call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }], body: btoa(JSON.stringify({ online: true })) });
  });
  await tab.call("Fetch.enable", { patterns: [{ urlPattern: "*/__rb/info*" }] });
  await load(chrome.cdp, tab, base, 500);
  const login = { name, email: `${name}@example.com`, token: await tokenFor(name) };
  await tab.eval(`localStorage.setItem("git-recon.eqosys", ${JSON.stringify(EQOSYS)}), localStorage.setItem("git-recon.login", ${JSON.stringify(JSON.stringify(login))})`);
  return { tab, sockets };
}

const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  for (let v = await get(); ; v = await get()) { if (ok(v)) return v; if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(200); }
};
const lobby = (t: Tab) => t.eval<{ shown: boolean; text: string; buttons: string[]; wide: boolean }>(`(() => { const b = document.getElementById("battle-lobby");
  return { shown: !b.hidden, text: b.textContent, buttons: [...b.querySelectorAll("button")].map((x) => x.textContent), wide: document.documentElement.scrollWidth > innerWidth }; })()`);

test.skipIf(!chromePath())("a party online: open it, a friend joins by its link on a phone and readies, Start sends both into its room", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    // The host, on a desktop: Party mints a code and shows the lobby with Start.
    const ada = await player(chrome, vite.url, "Ada", { w: 1280, h: 800 }, false);
    await load(chrome.cdp, ada.tab, vite.url, 2500);
    expect(await ada.tab.eval<boolean>(`!document.getElementById("battle-party").hidden`)).toBe(true);
    await ada.tab.eval(`document.querySelector(".more").open = true, document.getElementById("battle-party").click()`);
    const open = await until(() => lobby(ada.tab), (l) => l.shown && l.text.includes("Ada (host)"));
    expect(open.buttons).toContain("Start");
    expect(await ada.tab.eval<string>("location.search")).toBe(`?party=${CODE}`);

    // The friend opens the party's link on a phone: the lobby, a Ready button, and nothing wider than the screen.
    const bo = await player(chrome, vite.url, "Bo", { w: 390, h: 844 }, true);
    await load(chrome.cdp, bo.tab, `${vite.url}?party=${CODE}`, 2500);
    const joined = await until(() => lobby(bo.tab), (l) => l.text.includes("Bo"));
    expect(joined.buttons).toContain("Ready");
    await bo.tab.eval(`document.querySelector(".more").open = true`);
    expect((await lobby(bo.tab)).wide).toBe(false);
    await bo.tab.eval(`[...document.querySelectorAll("#battle-lobby button")].find((b) => b.textContent === "Ready").click()`);
    await until(() => lobby(ada.tab), (l) => l.text.includes("Bo ready"));

    // Start: both leave the lobby for /ws?room=CODE, signed in by their tokens.
    await ada.tab.eval(`[...document.querySelectorAll("#battle-lobby button")].find((b) => b.textContent === "Start").click()`);
    for (const [p, name] of [[ada, "Ada"], [bo, "Bo"]] as const) {
      const url = new URL(await until(async () => p.sockets.find((s) => s.includes("/ws?")) ?? "", (s) => !!s));
      expect(url.searchParams.get("room")).toBe(CODE);
      expect(url.searchParams.get("token")).toBe(JSON.parse((await p.tab.eval<string>(`localStorage.getItem("git-recon.login")`))).token);
      expect(url.searchParams.get("name")).toBe(name);
      expect((await lobby(p.tab)).shown).toBe(false);
      expect(await p.tab.eval<string>("location.search")).toBe(`?room=${CODE}`);
    }
    await ada.tab.close(), await bo.tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
