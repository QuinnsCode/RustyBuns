import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { cleanAvatar, defaultAvatar, PARTS, randomAvatar } from "../src/avatar.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

test("an avatar is every part, each a known option or a #rrggbb color; anything else is refused", () => {
  const a = defaultAvatar("ryan");
  expect(cleanAvatar(a)).toEqual(a);
  expect(cleanAvatar({ ...a, topColor: "#ABCDEF" })?.topColor).toBe("#abcdef");
  expect(cleanAvatar({ ...a, hat: "fez" })).toBeNull();
  expect(cleanAvatar({ ...a, skin: "red" })).toBeNull();
  const { build: _, ...short } = a;
  expect(cleanAvatar(short)).toBeNull();
  expect(cleanAvatar({ ...a, extra: "dropped" })).toEqual(a);
  expect(cleanAvatar(null)).toBeNull();
  let n = 1;
  for (let i = 0; i < 50; i++) expect(cleanAvatar(randomAvatar(() => ((n = (n * 16807) % 2147483647) / 2147483647)))).not.toBeNull();
  expect(defaultAvatar("ryan")).toEqual(defaultAvatar("ryan"));
  expect(PARTS.hair).toContain("none");
});

test("you save your avatar on your profile; others see it, and it walks the city with you", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string | null, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  const mine = defaultAvatar("someone else");
  expect((await send("ryan", "/api/me", { avatar: { ...mine, hat: "fez" } }, "PUT")).status).toBe(400);
  const ok = await send("ryan", "/api/me", { avatar: mine }, "PUT");
  expect(ok.status).toBe(200);
  expect(JSON.parse(((await ok.json()) as any).avatar)).toEqual(mine);
  // A later edit of the bio leaves it be; null takes it off.
  await send("ryan", "/api/me", { bio: "hi" }, "PUT");
  const seen = (await (await call(null, "/api/users/ryan")).json()) as any;
  expect(JSON.parse(seen.user.avatar)).toEqual(mine);
  await send("ryan", "/api/me", { avatar: null }, "PUT");
  expect(((await (await call(null, "/api/users/ryan")).json()) as any).user.avatar).toBe("");
});
