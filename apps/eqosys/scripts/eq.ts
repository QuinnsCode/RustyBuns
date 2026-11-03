// eqosys's tools from a shell or a script: the same functions the page hands a browser agent over WebMCP.
//   bun apps/eqosys/scripts/eq.ts                       list the tools (no sign-in)
//   bun apps/eqosys/scripts/eq.ts eq_apps '{"genre":"Sports & Skate"}' --token <app token>
//   bun apps/eqosys/scripts/eq.ts eq_batch '{"calls":[{"tool":"eq_apps","pick":["apps.id"]}]}'
// --url <origin> (default https://eqosys.qntbr.com); the token is what /api/exchange gave an app, or EQOSYS_TOKEN. Prints the answer as JSON.
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const url = (flag("url") ?? "https://eqosys.qntbr.com").replace(/\/$/, ""), token = flag("token") ?? process.env.EQOSYS_TOKEN;
const [name, raw] = argv;

if (!name) {
  const { tools } = await (await fetch(`${url}/api/tools`)).json() as { tools: { name: string; description: string }[] };
  for (const t of tools) console.log(`${t.name}\n  ${t.description}`);
  process.exit(0);
}
let args: unknown = {};
try { args = raw ? JSON.parse(raw) : {}; } catch { console.error("the arguments must be JSON"); process.exit(2); }
const res = await fetch(`${url}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args) });
console.log(JSON.stringify(await res.json(), null, 2));
process.exit(res.ok ? 0 : 1);
