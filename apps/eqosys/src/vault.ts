// One vault a person (@rustybuns/util/privacy's Vault): the key their cloud saves are sealed with, their consent ledger and the
// log of what they asked for. Someone whose first sign-in came from Europe (members.region = "eu") gets theirs in the EU's
// Durable Object jurisdiction, so the key, and with it every readable copy of their saves, stays there. Reached only from this Worker.
import { inRegion, Vault as VaultBody, vaultClient, type Namespace, type Region } from "@rustybuns/util/privacy";
import type { Env } from "./env.ts";

interface Stub { fetch(req: Request): Promise<Response> }
/** The VAULT binding: one vault a user id, in the EU's jurisdiction for people who signed up there. */
export type Vaults = Namespace<Stub>;

interface VaultCtx { storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean> } }

/** The Durable Object class: all of it is the shared vault body. */
export class Vault {
  private body: VaultBody;
  constructor(ctx: VaultCtx, _env: unknown) { this.body = new VaultBody(ctx.storage); }
  fetch(req: Request) { return this.body.fetch(req); }
}

/** Where a person's vault is: what their first sign-in recorded (null for anyone before vaults, and outside Europe). */
export const regionFor = async (conf: Env, userId: string): Promise<Region> =>
  (await conf.DB.prepare("SELECT region FROM members WHERE user_id = ?").bind(userId).first<string | null>("region")) === "eu" ? "eu" : null;

/** A person's vault, or null with no VAULT binding (saves are then kept unsealed). */
export async function vaultFor(conf: Env, userId: string) {
  if (!conf.VAULT) return null;
  const region = await regionFor(conf, userId);
  return vaultClient(inRegion(conf.VAULT, region, userId), region);
}

