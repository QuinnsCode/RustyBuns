// A player sends a bug report from a game: it becomes a GitHub issue tagged external and with the game, carrying no email,
// and one account can only send so many.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { PER_HOUR } from "../src/reports.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), GITHUB_REPORT_TOKEN: "test-token" });
const real = globalThis.fetch;
const filed: { auth: string | null; issue: { title: string; body: string; labels: string[] } }[] = [];
let github = 201;
beforeAll(() => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.github.com/repos/QuinnsCode/RustyBuns/issues")) return real(url as never, init);
    if (github !== 201) return new Response("{}", { status: github });
    filed.push({ auth: new Headers(init?.headers).get("authorization"), issue: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ number: 900 + filed.length }), { status: 201 });
  }) as never;
});
afterAll(() => { globalThis.fetch = real; });

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return who.token;
}

test("a report from a game becomes a labelled, anonymous issue, and an account is limited", async () => {
  const token = await signUp("Ada", "park-hide-seek", PARK);
  const send = (body: unknown, bearer = token) => call("/api/report", { json: body, bearer, origin: PARK });

  // Signed-out and mismatched callers get nothing.
  expect((await send({ kind: "bug", title: "Hiding spot", body: "x" }, "")).res.status).toBe(401);
  expect((await send({ kind: "bug", title: "Hiding spot", body: "x" }, "nonsense")).res.status).toBe(401);
  // Not the shape: nothing is filed and the slot isn't spent.
  expect((await send({ kind: "rant", title: "no", body: "x" })).res.status).toBe(400);
  expect(filed.length).toBe(0);

  const ok = await send({ kind: "bug", title: "Seeker walks through the hedge", body: "Ping @someone about #12", page: "/play", detail: "Error: x\n```boom```" });
  expect(ok.res.status).toBe(200);
  expect(await ok.res.json()).toEqual({ ok: true, issue: 901 });
  expect(ok.res.headers.get("access-control-allow-origin")).toBe(PARK);
  const [{ auth, issue }] = filed as [(typeof filed)[number]];
  expect(auth).toBe("Bearer test-token");
  expect(issue.labels).toEqual(["external", "game:park-hide-seek", "bug"]);
  expect(issue.title).toStartWith("[external][park-hide-seek] Bug: ");
  // Public repo: no email, no live @mention, no linked issue number.
  expect(issue.body).not.toContain("ada@example.com");
  expect(issue.body).not.toMatch(/@(?!​)\w/);
  expect(issue.body).toContain("u_");

  // A suggestion gets the enhancement label.
  await send({ kind: "suggestion", title: "More hedges", body: "please" });
  expect(filed[1]!.issue.labels).toEqual(["external", "game:park-hide-seek", "enhancement"]);

  // The account's hourly allowance runs out; another account is unaffected.
  for (let i = filed.length; i < PER_HOUR; i++) expect((await send({ kind: "bug", title: `Another ${i}`, body: "x" })).res.status).toBe(200);
  const over = await send({ kind: "bug", title: "One too many", body: "x" });
  expect(over.res.status).toBe(429);
  expect(filed.length).toBe(PER_HOUR);
  const other = await signUp("Bo", "qcrm", QCRM);
  expect((await call("/api/report", { json: { kind: "bug", title: "From the suite", body: "x" }, bearer: other, origin: QCRM })).res.status).toBe(200);
  expect(filed.at(-1)!.issue.labels[1]).toBe("game:qcrm");
});

test("when GitHub says no, the player is told and the slot is given back", async () => {
  const token = await signUp("Cy", "park-hide-seek", PARK);
  github = 500;
  const down = await call("/api/report", { json: { kind: "error", title: "Crash on load", body: "x" }, bearer: token, origin: PARK });
  expect(down.res.status).toBe(502);
  github = 201;
  for (let i = 0; i < PER_HOUR; i++) expect((await call("/api/report", { json: { kind: "bug", title: `Retry ${i}`, body: "x" }, bearer: token, origin: PARK })).res.status).toBe(200);
});
