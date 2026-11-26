# Inbound TCP and gRPC on Workers: what shipped, where it fits

Read 2026-11-20 from Cloudflare's docs. Everything here is **public beta**. Check the docs again before you build on it.

- Changelog: [Inbound TCP and gRPC for Workers and Containers](https://developers.cloudflare.com/changelog/post/2026-11-19-inbound-tcp/) (2026-11-19). On the same day there was also a [Spectrum dashboard redesign](https://developers.cloudflare.com/changelog/post/2026-11-19-redesigned-dashboard/). The redesign is UI only.
- Docs: [`connect()` handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/connect/),
  [Route TCP traffic to a Worker](https://developers.cloudflare.com/spectrum/how-to/route-tcp-traffic-to-a-worker/),
  [Bidirectional gRPC with Workers and Containers](https://developers.cloudflare.com/containers/examples/bidirectional-grpc/).

**In short:** until now, a Worker could only answer HTTP and WebSockets. Now any TCP client can reach one: `nc`, a
gRPC client, an MQTT device, a game client with its own binary protocol, a syslog sender, or `ssh`. A Worker can
also pass the raw bytes to a Durable Object, and the DO can pass them to a Container. Then a normal TCP server
(a gRPC server, `sshd`, `git daemon`) runs behind Cloudflare and no VPS is needed.

## How it works

```
TCP client -> Spectrum app (traffic_type "worker", one port) -> Worker connect() -> Durable Object connect() -> Container TCP port
```

```ts
export default {
  async connect(socket, env, ctx) {
    const { remoteAddress } = await socket.opened;   // the client's real IP and port; may be undefined
    await socket.readable.pipeTo(socket.writable);   // echo; the connection closes when this promise settles
  },
} satisfies ExportedHandler<Env>;
```

- It needs no compatibility flag. Local dev: `"connect": [{ "protocol": "tcp", "port": 8788 }]` in wrangler.jsonc. HTTP stays on 8787.
- **No TLS at the edge** on Pro or Business: Spectrum passes the bytes through unchanged, and `socket.startTls()` does
  not work on inbound sockets. A protocol that needs TLS must handle it itself, for example in the container (the gRPC example does this, with certificates from Secrets Store).
  Protocols with their own encryption (SSH) don't care.
- gRPC: the Worker never reads gRPC. It passes the HTTP/2 bytes through in both directions. The container runs `@grpc/grpc-js`
  over TLS with ALPN h2, so streaming in both directions works end to end.
- A Worker must not connect back to its own Spectrum hostname, and outbound connections to Cloudflare IPs are blocked.

## The cost gate (owner's call)

- **Free zones can't use it.** The zone needs Pro or Business (a paid plan; check the price on the plans page). Pro and Business get
  **one Worker-origin app per zone, on one TCP port**. More apps or ports need Spectrum Enterprise.
- Workers usage is billed separately from Spectrum, and Containers bill while they run. The docs give no TCP-specific price
  or limit. Price one real run before relying on it.
- Setup is one API call that needs the Worker's 32-character *tag*, not its name:
  `npx cf@latest spectrum apps create --zone <zone> --body '{"dns":{"type":"CNAME","name":"tcp.<zone>"},"protocol":"tcp/50051","traffic_type":"worker","origin_worker_id":"<tag>"}'`.
  That needs a token with Zone Settings Write, so the owner runs it.

## Where it would help us, best first

1. **codeSplitter over `ssh://` and `git://`.** Today codeSplitter only serves smart HTTP. With one port (22 or 9418)
   going to a Worker, then a DO per repo, then a small container running `git-shell` or `git daemon`, people could run `git clone ssh://...` and push
   with their own keys, and every push would still land in Artifacts. SSH encrypts its own traffic, so the lack of edge TLS doesn't matter. This
   is the biggest win, and it matches the "next-gen git platform" goal. The catch is the one port per Pro zone.
2. **Game worlds on a native protocol.** A desktop or native client (Mythic Masters, Two Fronts, the Rust/WASM games) could
   talk raw TCP to the same room DO it reaches over WebSockets now, without the HTTP upgrade or frame overhead. It is TCP only, with no
   UDP, so it does nothing for voice (Qlave) or for twitch netcode.
3. **gRPC into a container.** This helps with a service that already speaks gRPC (a model server, a third-party SDK). None of
   ours do, so wait until one does.
4. **Device and studio feeds.** These are MQTT, syslog, or OSC over TCP from hardware into Qollab Studio or Sound Guy Simulator. They are a nice idea, with no user yet.

## What RustyBuns would need

- Done (#5506): `worker.connect: { port }` carries the `connect` port into wrangler.jsonc and `rustybuns dev` (which
  opens the port and bridges it to the Worker), and a deploy ships the `connect` export as it is. Alchemy's Spectrum resource
  has no Worker origin, so the app is a `cf spectrum apps create` step the zone's owner runs (REFERENCE.md, "Inbound TCP").
- `Sockets` in `@rustybuns/util/room` handles WebSockets. A TCP room would need a framing layer (length-prefixed
  frames) so a room's `onMessage` gets the same messages from both kinds of connection.

None of this is built. The first step is the owner's call on a Pro zone, and then a codeSplitter `ssh://` spike.
