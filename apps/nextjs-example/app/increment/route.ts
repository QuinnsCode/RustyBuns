// POST /increment: bump the count in KV and send the browser back to /.
import { bump } from "../counter.ts";

export async function POST(req: Request): Promise<Response> {
  await bump();
  return Response.redirect(new URL("/", req.url), 303);
}
