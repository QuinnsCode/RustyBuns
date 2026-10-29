// What every eqosys test starts from: a fresh database, the routes called in-process, and an app's side of the handoff.
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { join } from "node:path";
import type { Env } from "../src/env.ts";
import { handle } from "../src/handle.ts";
import { challengeOf } from "../src/members.ts";

export const ORIGIN = "http://eqosys.local";
export const ADMIN = "boss@example.com", PASSWORD = "correct horse battery";
export const QCRM = "https://qcrm.qntbr.com", PARK = "https://park-hide-seek.notryanquinn.workers.dev";

export async function boot(extra: Partial<Env> = {}) {
  const conf: Env = { DB: d1(":memory:") as never, BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: ORIGIN, SUPER_ADMIN_EMAIL: ADMIN, ...extra };
  await applyD1Migrations(conf.DB as never, join(import.meta.dir, "../migrations"));
  const call = async (path: string, init: { form?: Record<string, string>; json?: unknown; cookie?: string; origin?: string; bearer?: string } = {}) => {
    const headers = new Headers({ origin: init.origin ?? ORIGIN });
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
    let body: BodyInit | undefined;
    if (init.form) body = new URLSearchParams(init.form);
    if (init.json !== undefined) { body = JSON.stringify(init.json); headers.set("content-type", "application/json"); }
    const res = (await handle(new Request(ORIGIN + path, { method: body ? "POST" : "GET", headers, body }), conf))!;
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { res, cookie, to: res.headers.get("location") ?? "" };
  };
  return { conf, call };
}

/** What an app does: a verifier it keeps, and the ask it sends people to /login with. */
export async function asks(app: string, origin: string) {
  const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
  return { verifier, form: { app, return: `${origin}/signed-in`, challenge: await challengeOf(verifier), state: "s1" } };
}
export const codeIn = (to: string) => new URL(to).searchParams.get("code")!;
