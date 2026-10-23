// Pay to play for looks: what only a purchase unlocks, and that a declined or failed payment unlocks nothing.
import { expect, test } from "bun:test";
import { DEFAULT_PARTS } from "../src/parts.ts";
import { type Checkout, Wallet, priceOf, testCheckout } from "../src/shop.ts";

const gold = { part: "trucks", id: "gold" } as const;

test("free parts are owned, priced ones are not until bought", async () => {
  const saved: string[][] = [];
  const w = new Wallet([], (o) => saved.push(o));
  expect(w.owns({ part: "deck", id: "sunset" })).toBe(true);
  expect(priceOf(gold)).toBeGreaterThan(0);
  expect(w.owns(gold)).toBe(false);
  expect(await w.buy(gold, testCheckout)).toBe(true);
  expect(w.owns(gold)).toBe(true);
  expect(saved).toEqual([["trucks:gold"]]);
});

test("a declined or throwing checkout buys nothing, and owning something is never charged twice", async () => {
  const w = new Wallet();
  expect(await w.buy(gold, async () => false)).toBe(false);
  expect(await w.buy(gold, async () => { throw new Error("offline"); })).toBe(false);
  expect(w.owns(gold)).toBe(false);
  let charges = 0;
  const count: Checkout = async () => (charges++, true);
  await w.buy(gold, count);
  await w.buy(gold, count);
  expect(charges).toBe(1);
});

test("a saved board wearing parts that were never bought is put back to the defaults for them", () => {
  const w = new Wallet(["wheels:mint"]);
  const out = w.allowed({ ...DEFAULT_PARTS, trucks: "gold", wheels: "mint", deck: "teal" });
  expect(out).toEqual({ ...DEFAULT_PARTS, wheels: "mint", deck: "teal" });
});
