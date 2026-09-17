// Browser-side helpers bundled into the desktop client.
export async function callAction<T = unknown>(module: string, fn: string, args: unknown[]): Promise<T> {
  const r = await fetch(`/__rb/action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ module, fn, args }),
  });
  if (!r.ok) throw new Error(`action ${module}#${fn}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
export function worldSocket(path = "/ws"): WebSocket {
  return new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
}
