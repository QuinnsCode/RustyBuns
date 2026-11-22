import { env } from "cloudflare:workers";
export async function visits() {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS visits (n INTEGER)");
  await env.DB.prepare("INSERT INTO visits (n) VALUES (1)").run();
  return (await env.DB.prepare("SELECT COUNT(*) AS c FROM visits").first("c")) as number;
}
