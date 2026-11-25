// An icon for each primitive, painted on the top of its block. Matched on the resource type's words, the first
// rule that fits wins, so `Cloudflare.D1.Database` and `Neon.Branch` both find theirs and an unknown type gets a box.
import { Archive, Bot, Box, Boxes, Clock, Cog, Container, Cpu, Database, Gauge, GitBranch, Globe, HardDrive, KeyRound, Layers, ListOrdered, Lock, Network, Route, Server, ShieldCheck, Sparkles, Waypoints, Workflow, Zap, type IconNode } from "lucide";

const RULES: [RegExp, IconNode][] = [
  [/workflow/i, Workflow],
  [/durable ?object/i, Boxes],
  [/container|sandbox/i, Container],
  [/worker|function|script/i, Zap],
  [/d1|database|postgres|redis|sql/i, Database],
  [/branch/i, GitBranch],
  [/r2|bucket|object|storage/i, Archive],
  [/kv|namespace/i, KeyRound],
  [/queue/i, ListOrdered],
  [/hyperdrive/i, Gauge],
  [/vectorize|index/i, Waypoints],
  [/ai\b|model|gateway/i, Sparkles],
  [/agent/i, Bot],
  [/dns|domain|zone|record/i, Globe],
  [/route/i, Route],
  [/server|machine|instance|droplet/i, Server],
  [/volume|disk/i, HardDrive],
  [/service/i, Cog],
  [/secret|key|cert/i, Lock],
  [/access|policy|rule|firewall|waf/i, ShieldCheck],
  [/cron|schedule|trigger/i, Clock],
  [/network|vpc|tunnel|endpoint/i, Network],
  [/project|stack|app/i, Layers],
  [/cpu|compute/i, Cpu],
];

/** The icon for a resource type (`Cloudflare.D1.Database`): its words after the provider decide. */
export function iconFor(type: string): IconNode {
  const words = type.split(".").slice(1).join(" ") || type;
  return RULES.find(([re]) => re.test(words))?.[1] ?? Box;
}

/** An icon as a little picture in `color`, ready for drawImage. Kept per icon and colour. */
const cache = new Map<string, HTMLImageElement>();
export function iconImage(node: IconNode, color: string, stroke = 2): HTMLImageElement {
  const key = `${JSON.stringify(node)}|${color}|${stroke}`;
  let img = cache.get(key);
  if (!img) {
    const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${String(v)}"`).join(" ")}/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(key, img);
  }
  return img;
}
