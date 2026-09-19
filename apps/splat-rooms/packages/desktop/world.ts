// The world: a class with a Durable Object's shape and no base class.
// The host binds it in-process with sqlite storage and alarms; the same class
// (plus `extends DurableObject`) is your Cloudflare shell.
export default class World {
  private boots = 0;
  constructor(private ctx: any, private env: any) {
    ctx.blockConcurrencyWhile(async () => {
      this.boots = ((await ctx.storage.get("boots")) ?? 0) + 1;
      await ctx.storage.put("boots", this.boots);
    });
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, name: request.headers.get("X-User-Name") });
    server.send(JSON.stringify({ t: "hello", userId, boots: this.boots, sockets: this.ctx.getWebSockets().length }));
    return new Response(null, { status: 101, webSocket: client } as any);
  }
  webSocketMessage(ws: any, m: string | ArrayBuffer) {
    for (const s of this.ctx.getWebSockets()) s.send(typeof m === "string" ? JSON.stringify({ t: "echo", m }) : m);
  }
  webSocketClose() {}
}
