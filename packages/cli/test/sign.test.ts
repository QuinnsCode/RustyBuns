import { expect, test } from "bun:test";
import { codesignArgs, developerIds, ENTITLEMENTS, notaryResult, pickIdentity, signDarwin } from "../src/sign.ts";

const FIND = `  1) 1111111111111111111111111111111111111111 "Apple Development: Ryan (AAAA)"
  2) 2222222222222222222222222222222222222222 "Developer ID Application: Ryan Quinn (TEAM123456)"
     2 valid identities found
`;

test("finds only Developer ID Application identities", () => {
  expect(developerIds(FIND)).toEqual(["Developer ID Application: Ryan Quinn (TEAM123456)"]);
  expect(developerIds("     0 valid identities found\n")).toEqual([]);
});

test("picks the one identity, RB_SIGN_IDENTITY over it, and says what to do otherwise", () => {
  expect(pickIdentity(["A"])).toBe("A");
  expect(pickIdentity(["A", "B"], "B")).toBe("B");
  expect(() => pickIdentity([])).toThrow(/Developer ID Application/);
  expect(() => pickIdentity(["A", "B"])).toThrow(/RB_SIGN_IDENTITY/);
});

test("signs with the hardened runtime, a timestamp and the JIT entitlements notarization needs", () => {
  const a = codesignArgs("dist/x-darwin-arm64", "Developer ID Application: R (T)", "/e.plist", "dev.rustybuns.x");
  expect(a).toContain("--timestamp");
  expect(a.slice(a.indexOf("--options"), a.indexOf("--options") + 2)).toEqual(["--options", "runtime"]);
  expect(a.at(-1)).toBe("dist/x-darwin-arm64");
  expect(ENTITLEMENTS).toContain("com.apple.security.cs.allow-jit");
});

test("reads notarytool's verdict, since --wait exits 0 on a rejection", () => {
  expect(notaryResult(`{"id":"abc","status":"Invalid","message":"Processing complete"}`)).toEqual({ id: "abc", status: "Invalid" });
  expect(notaryResult(`{"id":"abc","status":"Accepted"}`).status).toBe("Accepted");
});

test("no darwin outputs, nothing to sign", async () => {
  expect(await signDarwin(["dist/x-linux-x64", "dist/x-windows-x64.exe"], { identifier: "x" })).toEqual([]);
});
