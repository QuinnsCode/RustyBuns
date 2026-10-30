// A fixed account for App Review (guideline 2.1) to sign in to an app with: made through the app's own handoff,
// so it has the app's starting access. Run again to check it still signs in.
// Usage: bun scripts/review-account.ts <appId> <email> <password> [baseUrl]
import { APPS } from "../src/apps.ts";
import { b64url, digest } from "../src/env.ts";

const [id, email, password, base = "https://eqosys.qntbr.com"] = process.argv.slice(2);
const app = APPS.find((a) => a.id === id);
if (!app || !email || !password) throw new Error(`usage: bun scripts/review-account.ts <${APPS.map((a) => a.id).join("|")}> <email> <password> [baseUrl]`);
const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
const ask = { app: app.id, return: `${app.origins[0]}/signed-in`, challenge: b64url(await digest(verifier)), state: "review" };
for (const act of ["signin", "signup"]) {
  const res = await fetch(`${base}/do/${act}`, { method: "POST", redirect: "manual", headers: { origin: base }, body: new URLSearchParams({ ...ask, name: "App Review", email, password }) });
  if ((res.headers.get("location") ?? "").includes("code=")) { console.log(`${act === "signin" ? "already there" : "made"}: ${email} signs in to ${app.name}`); process.exit(0); }
}
throw new Error("neither signing in nor signing up worked: is the email taken with another password?");
