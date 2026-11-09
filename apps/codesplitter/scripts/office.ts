#!/usr/bin/env bun
// The office-preview's 3D office on this machine (#3423 slice 2): Agent Office's client, made by WebDevCody, served
// at /office/ by codeSplitter in-process (local()), signed in as the owner, against a real floor's object.
//
//   bun scripts/office.ts            prepare the office if needed, serve it, print the URL
//   --port 4791                      a port of your own (default 4791)
//   --seed                           put three tasks on the floor's queue and a worker at desk 3 first
//
// Nothing is deployed and nothing leaves this machine. The deployed look is MANUAL RUN #4062.
import path from "node:path";
import { serve } from "@rustybuns/shell-bun";
import { help } from "../../../scripts/help.ts";
import { local } from "../src/local.ts";
import { OFFICE_STAGE } from "../src/office-client.ts";
import worker from "../src/worker.ts";

help(import.meta.path);
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const PORT = Number(arg("--port") ?? 4791), OWNER = "quinn";
const app = path.dirname(import.meta.dir);

// The build as the office-preview stage runs it: the site, the office at /office/ and its headers.
await Bun.$`bun run build.ts`.cwd(app).env({ ...Bun.env, RUSTYBUNS_STAGE: OFFICE_STAGE });

const call = await local({ OFFICE: true, ADMINS: OWNER });
if (process.argv.includes("--seed")) {
  for (const prompt of ["Fix the login page", "Add a dark mode", "Speed up the file list"])
    await call(OWNER, "/api/office/main", { method: "POST", body: JSON.stringify({ t: "queue.add", prompt }) });
  await call(OWNER, "/api/office/main", { method: "POST", body: JSON.stringify({ t: "worker.spawn", deskId: "desk-3", name: "Bolt", prompt: "Fix the login page" }) });
}
// Every request is the owner's, as the preview's sign-in makes it (local() reads the name from cs_user).
const asOwner = {
  fetch(req: Request, env: unknown, ctx: unknown) {
    const h = new Headers(req.headers);
    h.set("cookie", [`cs_user=${OWNER}`, h.get("cookie")].filter(Boolean).join("; "));
    return (worker as any).fetch(new Request(req, { headers: h }), env, ctx);
  },
};
const shell = serve({ port: PORT, hostname: "127.0.0.1", assets: path.join(app, "dist/client"), runWorkerFirst: ["/api"] });
shell.mount(asOwner as any, call.env);
console.log(`Agent Office (by WebDevCody) from codeSplitter: http://127.0.0.1:${PORT}/office/`);
