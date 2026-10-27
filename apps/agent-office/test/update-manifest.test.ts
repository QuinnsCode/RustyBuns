import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { manifest } from "../scripts/update-manifest.ts";

const o = { version: "1.2.0", repo: "QuinnsCode/RustyBuns", tag: "agent-office-latest" };

test("the manifest points each Mac at its own signed bundle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "manifest-"));
  try {
    writeFileSync(path.join(dir, "agent-office-darwin-aarch64.app.tar.gz.sig"), "sig-arm\n");
    writeFileSync(path.join(dir, "agent-office-darwin-x86_64.app.tar.gz.sig"), "sig-intel\n");
    const m = manifest({ ...o, dir, date: new Date("2026-10-27T12:00:00Z") });
    expect(m.version).toBe("1.2.0");
    expect(m.pub_date).toBe("2026-10-27T12:00:00.000Z");
    expect(m.platforms["darwin-aarch64"]).toEqual({
      signature: "sig-arm",
      url: "https://github.com/QuinnsCode/RustyBuns/releases/download/agent-office-latest/agent-office-darwin-aarch64.app.tar.gz",
    });
    expect(m.platforms["darwin-x86_64"]?.signature).toBe("sig-intel");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unsigned build or a beta version never becomes a manifest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "manifest-"));
  try {
    writeFileSync(path.join(dir, "agent-office-darwin-aarch64.app.tar.gz.sig"), "sig-arm");
    expect(() => manifest({ ...o, dir })).toThrow("darwin-x86_64"); // the Intel signature is missing
    expect(() => manifest({ ...o, version: "1.3.0-beta.1", dir })).toThrow("not a stable version");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
