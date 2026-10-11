import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { main, run } from "../cli.ts";
import { installScript } from "../src/install.ts";
import { tools } from "../src/mcp.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** The app with ryan's private repo and a write token, and the CLI pointed at it in-process. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "private" });
  await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  const { token } = (await (await send("/api/tokens", { label: "cli", scope: "write" })).json()) as { token: string };
  const seen: Request[] = [];
  // The CLI's request, answered by the app in-process, headers and all.
  const fetch = (r: Request) => { seen.push(r); const u = new URL(r.url); return call(null, u.pathname + u.search, { method: r.method, headers: r.headers, body: r.body ? r.clone().body : undefined }); };
  const cli = (argv: string[], env: Record<string, string> = { CODESPLITTERS_URL: "http://site", CODESPLITTERS_TOKEN: token }, stdin = "") => main(argv, env, fetch, async () => stdin);
  return { cli, seen, fetch, token };
}

describe("bun cli.ts", () => {
  test("its commands are the MCP tools, with help for each", async () => {
    const { cli } = await app();
    const list = (await cli(["tools"])).out.split("\n").map((l) => l.split(" ")[0]);
    expect(list).toEqual(tools().map((t) => t.name));
    const help = await cli(["help", "read_file"]);
    expect(help.out).toContain("--owner (required)");
    expect((await cli(["help", "nope"])).code).toBe(2);
  });

  test("a command is the HTTP call, as the token's owner", async () => {
    const { cli, seen } = await app();
    const read = await cli(["read_file", "--owner", "ryan", "--repo", "lab", "--path", "a.ts"]);
    expect(read.code).toBe(0);
    const l = JSON.parse(read.out).lines[1];
    expect(seen[0]!.headers.get("user-agent")).toBe("codesplitters-cli/1");
    const body = JSON.stringify({ ops: [{ kind: "set", line: l.id, base: l.rev, text: "TWO" }] });
    expect((await cli(["edit_lines", "--owner", "ryan", "--repo", "lab", "--path", "a.ts", "--body", "-"], undefined, body)).code).toBe(0);
    const after = JSON.parse((await cli(["read_file", "--owner", "ryan", "--repo", "lab", "--path", "a.ts"])).out);
    expect(after.lines[1]).toMatchObject({ text: "TWO", by: "ryan" });
    // A stale base is the app's 409, passed on.
    const stale = await cli(["edit_lines", "--owner", "ryan", "--repo", "lab", "--path", "a.ts", "--body", body]);
    expect(stale).toMatchObject({ code: 1, err: expect.stringMatching(/^409/) });
  });

  test("the desktop app's launch URL goes as its cookie, beside the token", async () => {
    const { cli, seen, token } = await app();
    expect((await cli(["read_file", "--owner", "ryan", "--repo", "lab", "--path", "a.ts"], { CODESPLITTERS_URL: "http://127.0.0.1:5199/?token=launch", CODESPLITTERS_TOKEN: token })).code).toBe(0);
    expect(seen[0]!.url).toStartWith("http://127.0.0.1:5199/api/");
    expect(seen[0]!.url).not.toContain("launch");
    expect(seen[0]!.headers.get("cookie")).toBe("rb_token_5199=launch");
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  test("says what's missing", async () => {
    const { cli } = await app();
    expect((await cli(["read_file", "--owner", "ryan", "--repo", "lab"])).err).toContain("path is required");
    expect((await cli(["read_file", "--colour", "red"])).err).toContain("takes no --colour");
    expect((await cli(["edit_lines", "--body", "{nope"])).err).toContain("--body takes JSON");
    expect((await cli(["read_file"], {})).err).toContain("CODESPLITTERS_URL");
    expect((await cli(["read_file"], { CODESPLITTERS_URL: "http://site" })).err).toContain("CODESPLITTERS_TOKEN");
  });

  test("on the desktop, --as signs in as a handle", async () => {
    const { cli } = await app();
    const r = await cli(["read_file", "--owner", "ryan", "--repo", "lab", "--path", "a.ts", "--as", "ryan"], { CODESPLITTERS_URL: "http://site" });
    expect(r.code).toBe(0);
  });

  test("login saves the site and token, and every command after uses them", async () => {
    const { fetch, token } = await app();
    const home = mkdtempSync(`${tmpdir()}/cs-cli-`), env = { HOME: home };
    const login = await run(["login", "--url", "http://site/"], env, async () => token);
    expect(login).toMatchObject({ code: 0, out: expect.stringContaining("Signed in to http://site") });
    const file = `${home}/.config/codesplitters/config.json`;
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ url: "http://site", token });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const read = await run(["read_file", "--owner", "ryan", "--repo", "lab", "--path", "a.ts"], env, undefined, fetch);
    expect(read.code).toBe(0);
    // With no terminal to ask (the install script), it keeps the site and any token it had.
    expect((await run(["login", "--url", "http://site"], env, async () => undefined)).code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe(token);
  });

  test("/install.sh fetches this site's /cli.js and saves the site", async () => {
    const sh = await installScript("https://cs.example").text();
    expect(sh).toContain("curl -fsSL \"$site/cli.js\"");
    expect(sh).toContain("site='https://cs.example'");
    expect(sh).toContain('login --url "$site"');
  });
});
