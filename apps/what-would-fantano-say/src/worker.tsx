import { env } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { handleReview } from "./api.ts";
import { Document } from "./app/Document.tsx";
import { setCommonHeaders } from "./app/headers.ts";
import { Home } from "./app/pages/Home.tsx";

export default defineApp([
  setCommonHeaders(),
  route("/api/review", { post: ({ request }) => handleReview(request, env, (caches as unknown as { default: Cache }).default) }),
  render(Document, [route("/", () => <Home siteKey={env.TURNSTILE_SITE_KEY ?? ""} />)]),
]);
