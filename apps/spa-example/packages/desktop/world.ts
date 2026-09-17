// What the game repo's packages/desktop/world.ts looks like: the CF shell's
// body with the base class removed. ctx is structurally a DurableObjectState.
export default class World {
  private boots = 0;
  constructor(private ctx: any, private env: any) {
    ctx.blockConcurrencyWhile(async () => { this.boots = ((await ctx.storage.get("boots")) ?? 0) + 1; await ctx.storage.put("boots", this.boots); });
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("world DO — websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, name: request.headers.get("X-User-Name"), slug: request.headers.get("X-World-Slug") });
    server.send(JSON.stringify({ t: "hello", youUserId: userId, boots: this.boots, slug: request.headers.get("X-World-Slug") }));
    await this.env.PRESENCE_KV.put(`presence:${userId}`, "1", { expirationTtl: 60 });
    return new Response(null, { status: 101, webSocket: client } as any);
  }
  webSocketMessage(ws: any, m: string | ArrayBuffer) {
    const a = ws.deserializeAttachment();
    ws.send(JSON.stringify({ t: "echo", from: a.name, m: typeof m === "string" ? m : "bin", version: this.env.WEBAUTHN_APP_NAME }));
  }
  webSocketClose() {}
}
