import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { MATCH_ID } from "./archive.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { Home } from "./app/pages/Home.tsx";

export { Arena } from "./arena.ts";

const arena = () => env.ARENA.get(env.ARENA.idFromName("live"));

// Replays are public and read-only: anyone's office (or page) can fetch them.
const json = (body: BodyInit | null, maxAge: number, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*" } });

const app = defineApp([
  setCommonHeaders(),
  route("/api/live", ({ request }) => arena().fetch(request)),
  route("/api/matches", async () => {
    const index = await env.ARCHIVE?.get("index.json");
    return json(index ? index.body : "[]", 60);
  }),
  route("/api/matches/:id", async ({ params }) => {
    if (!MATCH_ID.test(params.id)) return json('{"error":"bad id"}', 60, 400);
    const m = await env.ARCHIVE?.get(`matches/${params.id}.json`);
    // A finished fight never changes.
    return m ? json(m.body, 31_536_000) : json('{"error":"not found"}', 60, 404);
  }),
  // Local dev only: start a practice fight now instead of waiting for the hour.
  route("/api/practice", async () =>
    import.meta.env.VITE_IS_DEV_SERVER ? Response.json(await arena().start()) : new Response("not here", { status: 404 })),
  // Local dev with EXCALIBRAWL_REAL_AI=1 only: the bake-off (src/lab/run.ts), one billed fight per call.
  route("/api/lab", async ({ request }) => {
    if (!import.meta.env.VITE_IS_DEV_SERVER || !import.meta.env.VITE_REAL_AI || !env.AI) return new Response("not here", { status: 404 });
    const { runLab, SETUPS } = await import("./lab/run.ts");
    const q = new URL(request.url).searchParams;
    const setup = q.get("setup") as keyof typeof SETUPS;
    if (!(setup in SETUPS) || !q.get("prompt")) return Response.json({ setups: SETUPS }, { status: 400 });
    const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
    return Response.json(await runLab(ai, setup, q.get("prompt")!, Math.min(36, Number(q.get("turns")) || 24)));
  }),
  render(Document, [route("/", () => <Home />)]),
]);

export default {
  fetch: app.fetch,
  // On the hour: the fight. Cron can run a few minutes late; the arena copes.
  async scheduled() {
    console.log("hourly fight", await arena().start());
  },
} satisfies ExportedHandler<Env>;
