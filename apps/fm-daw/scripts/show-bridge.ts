// The show bridge (#6474): what a browser can't do for the jam room's show desk, on your own computer. It carries
// OSC between the page and UDP, and sends the desk's DMX to real lights as Art-Net or sACN. Nothing is hosted: the
// page reaches it at ws://127.0.0.1, and only this command line says where UDP goes, never the page.
//
//   bun scripts/show-bridge.ts [options]        (in apps/fm-daw)
//     --artnet <host>       send DMX as Art-Net to this node (or a broadcast address, 192.168.1.255); repeatable
//     --sacn [host]         send DMX as sACN, to the universe's multicast group, or to one host
//     --universe <n>        Art-Net universe (default 0); sACN's is this plus 1
//     --osc-in <port>       hear OSC on this UDP port (default 9000)
//     --lan                 hear OSC from other devices too (a tablet running TouchOSC), not only this computer
//     --osc-out <host:port> send the desk's OSC here (a mixer, QLab, TouchOSC); repeatable
//     --port <port>         the page's WebSocket (default 5392)
//     --allow <origin>      another site whose pages may connect (localhost and the deployed studio may)
import { parseArgs } from "node:util";
import { originAllowed } from "@rustybuns/util/limits";
import { portArg } from "@rustybuns/util/ports";
import { help } from "../../../scripts/help.ts";
import { artDmx, ARTNET_PORT, SACN_PORT, sacnGroup, sacnPacket } from "../src/control/dmx.ts";
import { decodeOsc, encodeOsc } from "../src/control/osc.ts";
import { readWire, type Wire } from "../src/control/wire.ts";

const DEPLOYED = "https://fm-daw.notryanquinn.workers.dev";
export interface Target { host: string; port: number }
export interface BridgeOptions {
  port: number;
  oscIn: number;
  lan?: boolean;
  oscOut?: Target[];
  artnet?: Target[];
  sacn?: Target[];
  universe?: number;
  allow?: string[];
}

export async function showBridge(o: BridgeOptions) {
  const universe = o.universe ?? 0, cid = crypto.getRandomValues(new Uint8Array(16));
  const allowed = new Set([DEPLOYED, ...(o.allow ?? [])]);
  /** The desk's channels as last sent: repeated each second, as Art-Net and sACN receivers expect. */
  let last: Uint8Array | null = null, sequence = 0;
  const parse = (text: string): Wire | null => { try { return readWire(JSON.parse(text)); } catch { return null; } };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: o.port,
    fetch(req, srv) {
      const origin = req.headers.get("origin");
      // any page in the browser can try this port: only ours get in. Held against our own address, never the request's
      // Host, which a site that points its name at 127.0.0.1 gets to choose
      if (!(origin && allowed.has(origin)) && !originAllowed(origin, new URL(`http://127.0.0.1:${srv.port}`))) return new Response("Not from this site", { status: 403 });
      return srv.upgrade(req, { data: undefined }) ? undefined : new Response("The show bridge: connect from the studio's show desk");
    },
    websocket: {
      open(ws) {
        ws.subscribe("pages");
        if (last) ws.send(JSON.stringify({ t: "dmx", data: [...last] } satisfies Wire));
      },
      message(ws, raw) {
        const m = parse(String(raw));
        if (!m) return;
        if (m.t === "osc") {
          const packet = encodeOsc(m);
          for (const t of o.oscOut ?? []) udp.send(packet, t.port, t.host);
        } else {
          last = Uint8Array.from(m.data);
          lights();
          ws.publish("pages", JSON.stringify(m));
        }
      },
    },
  });

  const udp = await Bun.udpSocket({
    hostname: o.lan ? "0.0.0.0" : "127.0.0.1",
    port: o.oscIn,
    socket: {
      data(_, packet) {
        for (const m of decodeOsc(packet)) server.publish("pages", JSON.stringify({ t: "osc", ...m } satisfies Wire));
      },
      // a target that isn't there answers with an error: the rest still get theirs
      error() {},
    },
  });
  udp.setBroadcast(true);

  function lights() {
    if (!last) return;
    sequence = (sequence % 255) + 1;
    for (const t of o.artnet ?? []) udp.send(artDmx(universe, last, sequence), t.port, t.host);
    for (const t of o.sacn ?? []) udp.send(sacnPacket(universe + 1, last, sequence, cid), t.port, t.host);
  }
  const keep = setInterval(lights, 1000);

  return {
    url: `ws://127.0.0.1:${server.port}`,
    oscPort: udp.port,
    stop() { clearInterval(keep); udp.close(); void server.stop(true); },
  };
}

/** "host:port" or "host", the port then `dflt`. */
export function target(text: string, dflt: number): Target {
  const [host, port] = text.split(":");
  const n = port === undefined ? dflt : Number(port);
  if (!host || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`"${text}" isn't a host:port`);
  return { host, port: n };
}

if (import.meta.main) {
  help(import.meta.path);
  // --sacn with no host means the universe's multicast group
  const argv = process.argv.slice(2).flatMap((a, i, all) => (a === "--sacn" && (all[i + 1] ?? "--").startsWith("--") ? [a, "multicast"] : [a]));
  const { values: v } = parseArgs({ args: argv, options: {
    port: { type: "string" }, "osc-in": { type: "string" }, lan: { type: "boolean" }, universe: { type: "string" },
    "osc-out": { type: "string", multiple: true }, artnet: { type: "string", multiple: true }, sacn: { type: "string", multiple: true }, allow: { type: "string", multiple: true },
  } });
  const universe = Number(v.universe ?? 0);
  if (!Number.isInteger(universe) || universe < 0 || universe > 32767) throw new Error("--universe is a whole number from 0 to 32767");
  const oscOut = v["osc-out"]?.map((t) => { if (!t.includes(":")) throw new Error("--osc-out takes host:port"); return target(t, 0); });
  const artnet = v.artnet?.map((t) => target(t, ARTNET_PORT));
  const sacn = v.sacn?.map((t) => target(t === "multicast" ? sacnGroup(universe + 1) : t, SACN_PORT));
  const bridge = await showBridge({ port: portArg(v.port, "showBridge"), oscIn: portArg(v["osc-in"], "showOsc"), lan: v.lan, universe, oscOut, artnet, sacn, allow: v.allow });
  console.log(`Show bridge: the show desk connects to ${bridge.url}; OSC in on UDP ${bridge.oscPort}${v.lan ? " (this network)" : " (this computer)"}.`);
  console.log([artnet && `Art-Net to ${artnet.map((t) => t.host).join(", ")}`, sacn && `sACN to ${sacn.map((t) => t.host).join(", ")}`, oscOut && `OSC out to ${oscOut.map((t) => `${t.host}:${t.port}`).join(", ")}`].filter(Boolean).join("; ") || "No lights or OSC targets yet: --artnet, --sacn, --osc-out (see --help).");
}
