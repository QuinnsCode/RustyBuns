import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(60_000);

// The page's own road: build the dev host, then call the "use server" actions as the page does,
// through to Python and back. A Python error comes back as words, and the next call still works.
const app = join(import.meta.dir, "..");
const token = "python-react-token";

test("desktop: the page's actions run Python, and a Python error doesn't take the host down", async () => {
  const build = Bun.spawn(["bun", "../../packages/cli/src/index.ts", "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (await build.exited) throw new Error(await new Response(build.stderr).text());

  const home = mkdtempSync(join(tmpdir(), "python-react-"));
  const proc = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], { cwd: app, env: { ...process.env, HOME: home, RB_NO_BROWSER: "1", RB_TOKEN: token }, stdout: "pipe", stderr: "inherit" });
  try {
    let seen = "", url: string | undefined;
    for await (const chunk of proc.stdout) {
      seen += new TextDecoder().decode(chunk);
      if ((url = seen.match(/serving (http:\/\/[\d.]+:\d+)/)?.[1])) break;
    }
    if (!url) throw new Error(`host exited before serving:\n${seen}`);
    const host = url;
    const action = (fn: string, args: unknown[]) => fetch(`${host}/__rb/action`, {
      method: "POST",
      headers: { cookie: `rb_token_${new URL(host).port}=${token}`, "content-type": "application/json", origin: host },
      body: JSON.stringify({ module: "src/actions/python.ts", fn, args }),
    });

    expect(await (await action("about", [])).text()).toContain('"version":"3.');

    const bad = await action("summarize", [[]]);
    expect(bad.ok).toBe(false);
    expect(await bad.text()).toContain("ValueError: give me at least one number");

    const good = await action("summarize", [[1, 2, 3, 10]]);
    expect(await good.json()).toMatchObject({ count: 4, mean: 4, median: 2.5 });
  } finally {
    proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
