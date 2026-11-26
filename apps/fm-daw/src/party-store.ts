// Qevent's parties on the owner's account (#5932): one store per signed-in person, kept in the Profile Durable Object
// named `parties:<owner>` (the Worker checks their eqosys token and names the owner by a hash of their id). The owner
// reads and writes the whole store (`/parties`); anyone with a join link reads only the live party (`/live`).
import { check } from "@rustybuns/util/guard";
import { json, privateJson } from "@rustybuns/util/http";
import { EMPTY, liveParty, OWNER, Parties, type PartiesReply } from "./studio/party.ts";

/** Characters a saved store may take on the way in: two dozen parties with their versions, under a stored value's 2 MB. */
export const PARTIES_MAX = 1_500_000;

export interface Storage { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void> }

/** The owner key for an eqosys id (`eq:<sub>`): what join links carry instead of the id. */
export async function partyOwner(uid: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fm-daw-party:${uid}`)));
  return Array.from(d.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `/parties` (GET, PUT) and `/live` (GET) for the store of `owner`. */
export async function partyStore(storage: Storage, req: Request, owner: string): Promise<Response> {
  if (!OWNER.test(owner)) return json({ error: "no owner" }, 400);
  const path = new URL(req.url).pathname;
  const kept = async () => check(Parties, await storage.get("parties")) ?? EMPTY;
  if (path === "/live" && req.method === "GET") {
    const live = liveParty(await kept(), owner);
    // the scene on stage changes during the event: no cache keeps it
    return live ? privateJson(live) : json({ error: "nothing is live" }, 404);
  }
  if (path !== "/parties") return json({ error: "not found" }, 404);
  if (req.method === "GET") return privateJson({ owner, store: await kept() } satisfies PartiesReply);
  if (req.method !== "PUT") return json({ error: "GET or PUT" }, 405);
  const text = await req.text();
  if (text.length > PARTIES_MAX) return json({ error: "too big" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
  const store = check(Parties, body);
  if (!store) return json({ error: "that isn't a party store" }, 400);
  await storage.put("parties", store);
  return privateJson({ owner, store } satisfies PartiesReply);
}
