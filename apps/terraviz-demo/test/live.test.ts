// The real thing: `run.ts --shared` on the clone this machine built, and two browsers' worth of sockets on it. A
// teacher opens a class, a student joins and cannot take the lead, the teacher's tour reaches the student, and a late
// joiner lands in it. Skipped where there is no clone (CI): `bun apps/terraviz-demo/run.ts` makes one.
import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(180_000);
const clone = join(homedir(), "rustybuns-demos/terraviz/clones/zyra-project__terraviz");
const have = existsSync(join(clone, ".rustybuns/dev/desktop.js")) && !process.env.CI;

const freePort = () => { const s = Bun.serve({ port: 0, fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };

type Frame = Record<string, any>;
/** A browser's socket to the room: frames kept, and `next(t)` waits for the next frame of that kind. */
async function enter(base: string, cookie: string, q: string) {
  const got: Frame[] = [];
  const waiters: Array<{ t: string; ok: (f: Frame) => void }> = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/__sphere/ws?${q}`, { headers: { cookie } } as any);
  ws.onmessage = (e) => {
    const f = JSON.parse(String(e.data));
    const i = waiters.findIndex((w) => w.t === f.t);
    if (i >= 0) waiters.splice(i, 1)[0]!.ok(f); // a frame someone waits for is theirs; the rest is kept
    else got.push(f);
  };
  const next = (t: string, ms = 5000) => new Promise<Frame>((ok, no) => {
    const seen = got.find((f) => f.t === t);
    if (seen) { got.splice(got.indexOf(seen), 1); return ok(seen); }
    const timer = setTimeout(() => no(new Error(`no ${t} frame in ${ms} ms; got ${JSON.stringify(got.map((f) => f.t))}`)), ms);
    waiters.push({ t, ok: (f) => { clearTimeout(timer); ok(f); } });
  });
  await new Promise<void>((ok, no) => { ws.onopen = () => ok(); ws.onerror = () => no(new Error("socket refused")); });
  const hello = await next("hello");
  return { ws, hello, got, next, say: (m: object) => ws.send(JSON.stringify(m)), id: hello.you.id as string };
}

test.skipIf(!have)("a class on one globe: the teacher leads, a student follows and cannot take over, the tour reaches everyone", async () => {
  const port = freePort(), token = "livetest" + port.toString().padStart(24, "0");
  const host = Bun.spawn(["bun", join(import.meta.dir, "../run.ts"), "--shared", "--port", String(port)], {
    stdout: "pipe", stderr: "inherit", env: { ...process.env, RB_NO_BROWSER: "1", RB_TOKEN: token },
  });
  const base = `http://127.0.0.1:${port}`, cookie = `rb_token_${port}=${token}`;
  try {
    // wait for the host: it builds the Shared Sphere bundle first
    const reader = host.stdout.getReader(), dec = new TextDecoder();
    let log = "";
    while (!log.includes("[rustybuns] open http")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`host ended:\n${log}`);
      log += dec.decode(value);
    }
    void (async () => { while (!(await reader.read()).done); })();

    const page = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    expect(page).toContain('<script src="/__sphere/client.js" defer></script>');
    expect((await fetch(`${base}/__sphere/ws`)).status).toBe(403); // no launch token, no room
    const tours = await (await fetch(`${base}/__sphere/tours.json`, { headers: { cookie } })).json();
    expect(tours[0]).toMatchObject({ name: "three-places" });

    const teacher = await enter(base, cookie, "room=live-test&name=Ms%20Ada&teach=apple");
    expect(teacher.hello).toMatchObject({ you: { teacher: true }, locked: true });
    expect((await teacher.next("lead")).id).toBe(teacher.id);

    const student = await enter(base, cookie, "room=live-test&name=Linus");
    expect(student.hello).toMatchObject({ you: { teacher: false }, locked: true, lead: teacher.id });
    expect((await teacher.next("join")).name).toBe("Linus");
    student.say({ t: "lead" });
    student.say({ t: "cam", c: [1, 2], z: 3, b: 0, p: 0 });
    teacher.say({ t: "cam", c: [-105.3, 40], z: 4, b: 0, p: 0 });
    teacher.say({ t: "tour", url: "/__sphere/tours/three-places.json", i: 6, state: "paused" });
    expect(await student.next("cam")).toMatchObject({ from: teacher.id, c: [-105.3, 40] });
    expect((await student.next("tour")).tour).toEqual({ url: "/__sphere/tours/three-places.json", i: 6, state: "paused" });
    expect(teacher.got.filter((f) => f.t === "cam" || f.t === "lead")).toEqual([]);

    const late = await enter(base, cookie, "room=live-test&name=Grace");
    expect(late.hello).toMatchObject({ lead: teacher.id, cam: { c: [-105.3, 40] }, tour: { i: 6 }, locked: true });

    teacher.ws.close();
    expect((await student.next("leave")).id).toBe(teacher.id);
    expect((await student.next("lead")).id).toBeNull();
    student.ws.close(); late.ws.close();
  } finally {
    host.kill();
    await host.exited;
  }
});
