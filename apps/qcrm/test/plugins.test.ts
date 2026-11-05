import { expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ORIGIN } from "../src/local.ts";
import { local, person, post } from "./app-kit.ts";

type Call = Awaited<ReturnType<typeof local>>;
const TWILIO = { account_sid: "AC" + "0123456789abcdef".repeat(2), auth_token: "twilio-token-0123456789abcdef", from: "+1 (555) 000-1111" };
const PLIVO = { auth_id: "MAXXXXXXXXXXXXXXXXXX", auth_token: "plivo-token-0123456789abcdefghijklmnop", from: "+15550001111" };

/** Signatures made the way each provider documents them, apart from src/plugins.ts. */
const sorted = (params: Record<string, string>) => Object.keys(params).sort().map((k) => k + params[k]).join("");
const SIGN: Record<"twilio" | "plivo", (token: string, url: string, params: Record<string, string>) => Record<string, string>> = {
  // twilio.com/docs/usage/webhooks/webhooks-security: HMAC-SHA1 over the URL plus each param's name and value, sorted by name.
  twilio: (token, url, params) => ({ "x-twilio-signature": createHmac("sha1", token).update(url + sorted(params)).digest("base64") }),
  // plivo-python signature_v3.py for a POST to a URL without a query: url + "?" + sorted name+value, then "." + nonce, HMAC-SHA256.
  plivo: (token, url, params) => {
    const nonce = "12345678901234567890";
    return { "x-plivo-signature-v3-nonce": nonce, "x-plivo-signature-v3": createHmac("sha256", token).update(`${url}?${sorted(params)}.${nonce}`).digest("base64") };
  },
};

const form = (app: Call, path: string, params: Record<string, string>, headers: Record<string, string> = {}) =>
  app("", path, { method: "POST", body: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
const timeline = async (app: Call, cookie: string, org: string, contact: string) =>
  (await (await app(cookie, `/api/orgs/${org}/activities?contact_id=${contact}`)).json()).items as { type: string; body: string }[];

test.each([
  { kind: "twilio" as const, config: TWILIO, reply: { status: 201, body: { sid: "SM123" } }, id: "SM123",
    url: `https://api.twilio.com/2010-04-01/Accounts/${TWILIO.account_sid}/Messages.json`, user: TWILIO.account_sid,
    sent: (body: string) => Object.fromEntries(new URLSearchParams(body)), want: { To: "+15550102030", From: "+15550001111", Body: "Your table is ready" } },
  { kind: "plivo" as const, config: PLIVO, reply: { status: 202, body: { api_id: "x", message: "queued", message_uuid: ["db3ce55a"] } }, id: "db3ce55a",
    url: `https://api.plivo.com/v1/Account/${PLIVO.auth_id}/Message/`, user: PLIVO.auth_id,
    sent: (body: string) => JSON.parse(body), want: { src: "+15550001111", dst: "+15550102030", text: "Your table is ready" } },
])("$kind: connect, the token stays secret, a text goes out and lands on the timeline", async ({ kind, config, reply, id, url, user, sent, want }) => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const made = await post(app, cookie, `/api/orgs/${org}/plugins/${kind}`, config, "PUT");
  expect(made.status).toBe(200);
  const plugin = await made.json();
  expect(plugin.inbound_url).toMatch(new RegExp(`^${ORIGIN}/api/in/in_[A-Za-z0-9_-]{32}$`));
  expect(plugin.config.auth_token).toBe("…" + config.auth_token.slice(-4));
  expect(plugin.config.from).toBe("+15550001111");
  const listed = await (await app(cookie, `/api/orgs/${org}/plugins`)).json();
  expect(listed.map((p: { kind: string; connected: boolean }) => [p.kind, p.connected])).toEqual([["twilio", kind === "twilio"], ["plivo", kind === "plivo"], ["form", false]]);
  expect(JSON.stringify(listed)).not.toContain(config.auth_token);
  expect(listed.find((p: { kind: string }) => p.kind === kind).inbound_url).toBe(`${ORIGIN}/api/in/…${plugin.inbound_url.slice(-4)}`);
  const stored = await app.env.DB.prepare("SELECT config FROM plugins WHERE org_id = ?").bind(org).first<string>("config");
  expect(stored).not.toContain(config.auth_token);

  const contact = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", phone: "555-010-2030" })).json();
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json(reply.body, { status: reply.status });
  }, { preconnect: fetch.preconnect }));
  let res: Response;
  try { res = await post(app, cookie, `/api/orgs/${org}/contacts/${contact.id}/sms`, { body: "Your table is ready" }); } finally { stub.mockRestore(); }
  expect(res.status).toBe(201);
  const out = await res.json();
  expect(out.provider_id).toBe(id);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(url);
  expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Basic " + btoa(`${user}:${config.auth_token}`));
  expect(sent(String(calls[0]!.init.body))).toMatchObject(want);
  expect(out.activity).toMatchObject({ type: "sms", contact_id: contact.id, body: "Sent: Your table is ready" });

  // The audit says what happened to the plugin, never the token.
  const audit = await (await app(cookie, `/api/orgs/${org}/audit?action=plugin`)).json();
  expect(audit.items.map((a: { action: string }) => a.action)).toEqual(["plugin.connect"]);
  expect(JSON.stringify(audit)).not.toContain(config.auth_token);
});

test.each(["twilio", "plivo"] as const)("%s: a signed inbound text lands on the matching contact, a new number becomes a contact, an unsigned one is refused", async (kind) => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const config = kind === "twilio" ? TWILIO : PLIVO;
  const { inbound_url } = await (await post(app, cookie, `/api/orgs/${org}/plugins/${kind}`, config, "PUT")).json();
  const path = inbound_url.slice(ORIGIN.length);
  const ada = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", phone: "(555) 010-2030" })).json();
  // Plivo sends the number without a +; Twilio with one.
  const params = (from: string, text: string): Record<string, string> => kind === "twilio" ? { From: from, To: "+15550001111", Body: text, MessageSid: "SM9" } : { From: from.slice(1), To: "15550001111", Text: text, Type: "sms", MessageUUID: "u9" };

  const p1 = params("+15550102030", "See you at 7");
  const res = await form(app, path, p1, SIGN[kind](config.auth_token, inbound_url, p1));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/xml");
  expect(await res.text()).toBe("<Response/>");
  expect(await timeline(app, cookie, org, ada.id)).toMatchObject([{ type: "sms", body: "Received: See you at 7" }]);

  const p2 = params("+15559990000", "Who is this?");
  expect((await form(app, path, p2, SIGN[kind](config.auth_token, inbound_url, p2))).status).toBe(200);
  const { items } = await (await app(cookie, `/api/orgs/${org}/contacts`)).json();
  const stranger = items.find((c: { id: string }) => c.id !== ada.id);
  expect(stranger).toMatchObject({ phone: "+15559990000", tags: ["inbound"] });
  expect(await timeline(app, cookie, org, stranger.id)).toMatchObject([{ type: "sms", body: "Received: Who is this?" }]);

  // No signature, one made with another token, or a body changed after signing: refused, nothing filed.
  const p3 = params("+15550102030", "Wire me money");
  expect((await form(app, path, p3)).status).toBe(403);
  expect((await form(app, path, p3, SIGN[kind]("not-the-token", inbound_url, p3))).status).toBe(403);
  expect((await form(app, path, p3, SIGN[kind](config.auth_token, inbound_url, p1))).status).toBe(403);
  expect(await timeline(app, cookie, org, ada.id)).toHaveLength(1);

  // Rotating retires the old URL.
  const rotated = await (await post(app, cookie, `/api/orgs/${org}/plugins/${kind}`, { rotate: true }, "PUT")).json();
  expect(rotated.inbound_url).not.toBe(inbound_url);
  expect((await form(app, path, p1, SIGN[kind](config.auth_token, inbound_url, p1))).status).toBe(404);
});

test("a lead form creates a contact, the same email again updates it, and a plain HTML form is redirected", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const { inbound_url } = await (await post(app, cookie, `/api/orgs/${org}/plugins/form`, {}, "PUT")).json();
  const path = inbound_url.slice(ORIGIN.length);

  const preflight = await app("", path, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

  const first = await post(app, "", path, { name: "Grace Brewster Hopper", email: "Grace@Navy.example", company: "Navy", message: "Do you cater?" });
  expect(first.status).toBe(201);
  expect(first.headers.get("access-control-allow-origin")).toBe("*");
  expect(await first.json()).toEqual({ ok: true });
  const again = await form(app, path, { email: "grace@navy.example", phone: "555 010 4040", message: "Also Sundays?", redirect: "https://navy.example/thanks" });
  expect(again.status).toBe(303);
  expect(again.headers.get("location")).toBe("https://navy.example/thanks");

  const { items } = await (await app(cookie, `/api/orgs/${org}/contacts`)).json();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ first_name: "Grace", last_name: "Brewster Hopper", email: "grace@navy.example", phone: "555 010 4040", tags: ["form"] });
  const company = await (await app(cookie, `/api/orgs/${org}/companies/${items[0].company_id}`)).json();
  expect(company.name).toBe("Navy");
  expect((await timeline(app, cookie, org, items[0].id)).map((a) => a.body).sort()).toEqual(["From the form: Also Sundays?", "From the form: Do you cater?"]);

  expect((await post(app, "", path, { name: "Nobody", message: "hi" })).status).toBe(400);
  expect((await post(app, "", path, { email: "x@y.example", message: "x".repeat(17_000) })).status).toBe(413);
  expect((await post(app, "", "/api/in/in_guessed", { email: "x@y.example" })).status).toBe(404);
});

test("a trial org can't connect a phone plugin; texts need a phone and a plugin; only owners connect", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const bob = await person(app, "bob@qcrm.test");
  await post(app, cookie, `/api/orgs/${org}/members`, { email: "bob@qcrm.test", role: "manager" });
  expect((await post(app, bob.cookie, `/api/orgs/${org}/plugins/twilio`, TWILIO, "PUT")).status).toBe(403);

  const noPhone = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada" })).json();
  const withPhone = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Bo", phone: "+44 20 7946 0000" })).json();
  expect((await post(app, cookie, `/api/orgs/${org}/contacts/${withPhone.id}/sms`, { body: "hi" })).status).toBe(409);
  await post(app, cookie, `/api/orgs/${org}/plugins/twilio`, TWILIO, "PUT");
  expect((await post(app, cookie, `/api/orgs/${org}/contacts/${noPhone.id}/sms`, { body: "hi" })).status).toBe(400);
  expect((await post(app, cookie, `/api/orgs/${org}/contacts/${withPhone.id}/sms`, { body: "hi", via: "plivo" })).status).toBe(409);
  expect((await post(app, cookie, `/api/orgs/${org}/plugins/plivo`, { auth_id: PLIVO.auth_id }, "PUT")).status).toBe(400);

  await app.env.DB.prepare("UPDATE orgs SET plan = 'scenario' WHERE id = ?").bind(org).run();
  const refused = await post(app, cookie, `/api/orgs/${org}/plugins/plivo`, PLIVO, "PUT");
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toContain("trial org");
  expect((await post(app, cookie, `/api/orgs/${org}/plugins/form`, {}, "PUT")).status).toBe(200);

  // Deleting the org takes its plugins with it.
  expect((await app(cookie, `/api/orgs/${org}`, { method: "DELETE" })).status).toBe(200);
  expect(await app.env.DB.prepare("SELECT COUNT(*) AS n FROM plugins WHERE org_id = ?").bind(org).first<number>("n")).toBe(0);
});
