// The one binding this app reads, through OpenNext's own accessor: on Cloudflare it is the
// Worker's KV namespace, and the desktop host backs the same binding with a folder.
import { getCloudflareContext } from "@opennextjs/cloudflare";

const kv = () => getCloudflareContext().env.COUNTER;

export const readCount = async () => Number((await kv().get("count")) ?? 0);

export async function bump(): Promise<number> {
  const n = (await readCount()) + 1;
  await kv().put("count", String(n));
  return n;
}
