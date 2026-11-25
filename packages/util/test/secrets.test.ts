import { expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eqosysLogin, fileSecrets, keychain, osSecrets, storeFor, withFallback, type Secrets } from "../src/secrets.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "secrets-"));

test("each desktop OS gets its own store", () => {
  expect(["darwin", "win32", "linux", "freebsd"].map(storeFor)).toEqual(["keychain", "credential-manager", "secret-service", "file"]);
  expect(() => osSecrets("svc", { platform: "freebsd" })).toThrow(/fallbackDir/);
});

test("the Mac keychain gets the value on stdin as hex, never on a command line", async () => {
  const items = new Map<string, string>(), lines: string[][] = [];
  const security = async (args: string[], stdin?: string) => {
    lines.push(args);
    if (args[0] === "-i") {
      const [, , , service, , account, , data] = stdin!.trim().split(" ");
      items.set(`${service}/${account}`, Buffer.from(data!, "hex").toString());
      return { code: 0, out: "", err: "" };
    }
    const held = items.get(`${args[2]}/${args[4]}`);
    if (args[0] === "delete-generic-password") items.delete(`${args[2]}/${args[4]}`);
    return held === undefined ? { code: 44, out: "", err: "not found" } : { code: 0, out: `${held}\n`, err: "" };
  };
  const kc = keychain("eqosys", security);
  expect(await kc.get("park")).toBeNull();
  await kc.set("park", '{"name":"Zo\\u00eb","token":"a b"}');
  expect(await kc.get("park")).toBe('{"name":"Zo\\u00eb","token":"a b"}');
  expect(lines.flat().join(" ")).not.toContain("Zo");
  await kc.remove("park");
  expect(await kc.get("park")).toBeNull();
  await expect(kc.set("bad name", "x")).rejects.toThrow(/name a secret/);
});

test("Linux with no Secret Service keeps secrets in a private file, and moves them in once it answers", async () => {
  const dir = scratch(), file = fileSecrets(dir, "office");
  const dead: Secrets = { get: () => Promise.reject(new Error("no D-Bus")), set: () => Promise.reject(new Error("no D-Bus")), remove: () => Promise.reject(new Error("no D-Bus")) };
  const box = withFallback(dead, file);
  await box.set("ryan", "gho_abc");
  expect(await box.get("ryan")).toBe("gho_abc");
  expect(statSync(join(dir, "office.json")).mode & 0o777).toBe(0o600);

  // later the same box gets a keyring: the token moves out of the file on first read
  const ring = new Map<string, string>();
  const live: Secrets = { get: async (a) => ring.get(a) ?? null, set: async (a, v) => void ring.set(a, v), remove: async (a) => void ring.delete(a) };
  const after = withFallback(live, fileSecrets(dir, "office"));
  expect(await after.get("ryan")).toBe("gho_abc");
  expect(ring.get("ryan")).toBe("gho_abc");
  expect(await file.get("ryan")).toBeNull();
});

test("a desktop app keeps its eqosys sign-in, and signs out", async () => {
  const dir = scratch(), secrets = fileSecrets(dir, "eqosys"), store = eqosysLogin("park-hide-seek", { secrets });
  expect(await store.load()).toBeNull();
  const login = { name: "Zoë Ångström", email: "zoe@example.com", refresh: "r1" };
  await store.save({ ...login, token: "a.b.c" });
  expect(await store.load()).toEqual(login);   // never the access token
  expect(store.save({ name: 1 })).rejects.toThrow();
  await secrets.set("park-hide-seek", '{"name":1}');
  expect(await store.load()).toBeNull();
  await store.save(null);
  expect(await secrets.get("park-hide-seek")).toBeNull();
});
