// The sign-up list for people who own a place worth scanning (the real-places scanning game). One Durable Object holds
// it, a row per email (signing up again with the same email just updates the place), capped so nobody can fill it.
import { check } from "@rustybuns/util/guard";
import { json, readBody } from "@rustybuns/util/http";
import { SpotSignup } from "../api.ts";

export const MAX_SIGNUPS = 5000;

interface Store { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>; list(o: { prefix: string; limit: number }): Promise<Map<string, unknown>> }

export class Signups {
  constructor(private ctx: { storage: Store }) {}
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("post only", { status: 405 });
    const got = check(SpotSignup, await readBody(req));
    if (!got) return json({ error: "need a real email and a place" }, 400);
    const key = `s:${got.email.toLowerCase()}`;
    const { storage } = this.ctx;
    if (!(await storage.get(key)) && (await storage.list({ prefix: "s:", limit: MAX_SIGNUPS })).size >= MAX_SIGNUPS) return json({ error: "the list is full for now" }, 503);
    await storage.put(key, { ...got, at: Date.now() });
    return json({ ok: true });
  }
}
