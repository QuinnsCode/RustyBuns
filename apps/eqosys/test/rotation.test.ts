// Rotating the signing key keeps yesterday's tokens good until they expire.
import { expect, test } from "bun:test";
import { jwksOf, newKey, sign, verify } from "@rustybuns/util/token";

const who = { user: { id: "u1", email: "a@example.com", name: "Ada" }, app: "park-hide-seek", source: "eqosys", access: ["play"] };
const want = { iss: "https://eqosys.test", aud: "park-hide-seek" };

test("after a rotation the JWKS holds the new key and the old, so an old token still verifies", async () => {
  const a = await newKey(), b = await newKey();
  const old = (await sign({ EQOSYS_SIGNING_KEY: a }, want.iss, who))!;
  const rotated = { EQOSYS_SIGNING_KEY: b, EQOSYS_PREVIOUS_KEYS: JSON.stringify([JSON.parse(a)]) };
  const jwks = await jwksOf(rotated);
  expect(jwks.keys).toHaveLength(2);
  expect(JSON.stringify(jwks)).not.toContain('"d"');
  expect((await verify(old, jwks, want))?.sub).toBe("u1");
  expect((await verify((await sign(rotated, want.iss, who))!, jwks, want))?.sub).toBe("u1");
  expect(await verify(old, await jwksOf({ EQOSYS_SIGNING_KEY: b }), want)).toBeNull();
  expect((await jwksOf({ EQOSYS_SIGNING_KEY: b, EQOSYS_PREVIOUS_KEYS: "nonsense" })).keys).toHaveLength(1);
});
