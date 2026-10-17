import { expect, test } from "bun:test";
import { sign } from "../src/webhooks.ts";
import { local, person, post } from "./app-kit.ts";

/** A receiver on a free port: every request it gets, and a promise for the next one. */
function receiver(status = 200) {
  const got: { headers: Headers; body: string }[] = [];
  let wake: (() => void) | null = null;
  const server = Bun.serve({ port: 0, fetch: async (req) => { got.push({ headers: req.headers, body: await req.text() }); wake?.(); return new Response("", { status }); } });
  return { got, url: `http://127.0.0.1:${server.port}/hook`, next: () => new Promise<void>((r) => { wake = r; }), stop: () => server.stop(true) };
}

test("a signed delivery arrives and the signature verifies", async () => {
  const app = await local();
  const { cookie, org, user } = await person(app, "alice@qcrm.test");
  const rx = receiver();
  try {
    const made = await post(app, cookie, `/api/orgs/${org}/webhooks`, { url: rx.url, events: ["contact.created", "member.added"] });
    expect(made.status).toBe(201);
    const hook = await made.json();
    expect(hook.secret).toHaveLength(48);
    expect((await post(app, cookie, `/api/orgs/${org}/webhooks`, { url: "ftp://example.com/x" })).status).toBe(400);
    expect((await post(app, cookie, `/api/orgs/${org}/webhooks`, { url: rx.url, events: ["contact.exploded"] })).status).toBe(400);

    const arrived = rx.next();
    const contact = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", email: "ada@example.com" })).json();
    await arrived;
    expect(rx.got).toHaveLength(1);
    const { headers, body } = rx.got[0]!;
    expect(headers.get("x-qcrm-event")).toBe("contact.created");
    expect(headers.get("x-qcrm-signature")).toBe(await sign(hook.secret, body));
    const payload = JSON.parse(body);
    expect(payload.data.id).toBe(contact.id);
    expect(payload.org).toBe(org);
    expect(payload.data.email).toBe("ada@example.com");

    // An event the hook didn't ask for is not sent.
    await post(app, cookie, `/api/orgs/${org}/contacts/${contact.id}`, { title: "CTO" }, "PUT");
    await (app.env.HOOKS as any).drain(Date.now() + 1);
    expect(rx.got).toHaveLength(1);

    const deliveries = await (await app(cookie, `/api/orgs/${org}/webhooks/${hook.id}/deliveries`)).json();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("ok");
    expect(deliveries[0].last_code).toBe(200);
    expect(headers.get("x-qcrm-delivery")).toBe(deliveries[0].id);
    expect(user.id).toBeString();
  } finally { rx.stop(); }
});

test("a failing endpoint is retried with backoff, then the delivery is dead", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const rx = receiver(500);
  try {
    const hook = await (await post(app, cookie, `/api/orgs/${org}/webhooks`, { url: rx.url, events: ["company.created"] })).json();
    const arrived = rx.next();
    await post(app, cookie, `/api/orgs/${org}/companies`, { name: "Cedar Labs" });
    await arrived;
    const path = `/api/orgs/${org}/webhooks/${hook.id}/deliveries`;
    let [d] = await (await app(cookie, path)).json();
    expect(d.status).toBe("pending");
    expect(d.attempts).toBe(1);
    expect(d.next_at).toBeGreaterThan(Date.now() + 100_000);   // 60 * 2^1 s away
    // Time travel: deliver everything due in the next day, round after round, until it gives up.
    for (let i = 0; i < 12 && d.status === "pending"; i++) {
      await (app.env.HOOKS as any).drain(Date.now() + 86_400_000);
      [d] = await (await app(cookie, path)).json();
    }
    expect(d.status).toBe("dead");
    expect(d.attempts).toBe(8);
    expect(d.next_at).toBeNull();
    expect(d.last_code).toBe(500);
    expect(rx.got).toHaveLength(8);
  } finally { rx.stop(); }
});
