// Voice on the /spaces page, under the policy the worker sends (csp.ts): Ada, signed in, makes a space, adds a voice channel
// and joins it with Qlave's real client on a stand-in microphone. Its socket reaches a stand-in Qlave on another origin
// with her ticket, and she is in the channel. A page under /login's policy can't open that socket at all.
// eqosys runs in-process with its Space object and serves the page; headless Chrome drives it over CDP (scripts/chrome.ts).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { durableObject, serve } from "@rustybuns/shell-bun";
import type { SpacesState } from "@rustybuns/util/spaces";
import { newKey } from "@rustybuns/util/token";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { SpacesPage } from "../src/app/pages.tsx";
import { pageCsp } from "../src/csp.ts";
import { handle } from "../src/handle.ts";
import { Space } from "../src/qollab/space.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(120_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/app/commands.client.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), LOOPBACK_RETURNS: "1" });
conf.SPACE = durableObject(Space as never, conf) as never;

// Qlave, stood in for on its own port (so its own origin): it lets each voice socket in and says who joined.
const tickets: string[] = [];
const qlave = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch: (req, server) => {
    const u = new URL(req.url);
    if (u.pathname !== "/__qlave/voice") return Response.json({ ok: true });
    tickets.push(u.searchParams.get("eqosys") ?? "");
    return server.upgrade(req) ? undefined : new Response("no", { status: 400 });
  },
  websocket: { open: (ws) => void ws.send(JSON.stringify({ type: "joined", peers: [], self: { sub: "ada", name: "Ada" } })), message: () => {} },
});
conf.QLAVE_URL = `http://127.0.0.1:${qlave.port}`;

// The pages as the worker renders them, each with the policy the worker sends for its path.
const page = (path: string) => new Response("<!doctype html>" + renderToStaticMarkup(<Document><SpacesPage t0={0} /></Document>),
  { headers: { "content-type": "text/html", "content-security-policy": pageCsp(path, "'self'", conf) } });
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => {
  const path = new URL(req.url).pathname;
  if (path === "/spaces" || path === "/login") return page(path);
  if (path === "/src/app/commands.client.ts") return new Response(script, { headers: { "content-type": "text/javascript" } });
  return (await handle(req, conf)) ?? new Response("no", { status: 404 });
} } as never, {});
const base = `http://127.0.0.1:${shell.port}`;

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); shell.stop(); qlave.stop(true); });

const until = async (what: string, f: () => Promise<unknown> | unknown, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await f()) return;
  throw new Error(`never saw ${what}`);
};
// A microphone headless Chrome doesn't have: a silent Web Audio stream in getUserMedia's place.
const FAKE_MIC = `navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;`;

test("join a voice channel on /spaces; /login's policy keeps the socket home", async () => {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name: "Ada", email: "ada@example.com", password: PASSWORD } });
  expect((await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.status).toBe(200);

  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await tab.call("Network.setCookies", { cookies: up.cookie.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url: base })) });
  await tab.call("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_MIC });
  await load(chrome.cdp, tab, `${base}/spaces`, 0);
  const state = () => tab.eval<SpacesState | null>("window.__spaces?.state() ?? null").catch(() => null);
  const seen = async (what: string, ok: (s: SpacesState) => boolean) => {
    try { await until(what, async () => { const s = await state(); return s && ok(s); }); }
    catch (e) { throw new Error(`${(e as Error).message}: ${JSON.stringify(await state())} ${tab.noise.join(" | ")}`); }
  };
  const type = (placeholder: string, text: string) => tab.eval(`(() => { const i = document.querySelector('#spaces input[placeholder=${JSON.stringify(placeholder)}]'); i.value = ${JSON.stringify(text)}; i.form.requestSubmit(); })()`);

  await seen("an empty list", (s) => s.open === null && s.spaces.length === 0);
  await type("Name a new space", "Night ride");
  await seen("the new space open", (s) => s.open === "Night ride");
  await type("new-voice-channel", "lounge");
  await seen("the lounge tab", (s) => s.voices.join() === "lounge");
  await tab.eval(`[...document.querySelectorAll('#spaces [role=tab]')].find((b) => b.textContent === "lounge").click()`);
  await tab.eval(`document.querySelector('#spaces button[title="Join lounge"]').click()`);
  await seen("Ada in the lounge", (s) => s.inVoice === "lounge" && s.speakers.join() === "Ada");
  expect(tickets).toHaveLength(1);
  expect(tickets[0]).toStartWith("ey");
  expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);

  // The same socket from a page under /login's policy is refused before it leaves the browser.
  await load(chrome.cdp, tab, `${base}/login`, 0);
  const refused = await tab.eval<string>(`new Promise((done) => {
    document.addEventListener("securitypolicyviolation", (e) => done(e.effectiveDirective));
    try { new WebSocket(${JSON.stringify(`ws://127.0.0.1:${qlave.port}/__qlave/voice?eqosys=x`)}); } catch { /* Chrome may throw as well */ }
  })`);
  expect(refused).toBe("connect-src");
  await Bun.sleep(200);
  expect(tickets).toHaveLength(1);
  await tab.close();
});
