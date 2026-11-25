// A made-up fleet for `?demo` and `--demo`: what hemyviz looks like before you have state of your own, and the
// fixture the tests and the probe draw. Fixed times and names, so it always draws the same.
import type { Fleet, Resource, Stack } from "./api.ts";

const T0 = Date.UTC(2026, 10, 1);
const HOUR = 3_600_000;

type Row = [fqn: string, type: string, downstream?: string[], extra?: Partial<Resource>];

function stack(name: string, stage: string, hoursAgo: number, rows: Row[], app = `apps/${name}`): Stack {
  const resources = rows.map(([fqn, type, downstream = [], extra = {}], i): Resource => ({
    fqn, type, status: "created", downstream, bindings: downstream.length, props: 3 + (i % 4), kept: false, mode: "live",
    updatedAt: T0 + (24 * 21 - hoursAgo) * HOUR + i * 7 * 60_000, ...extra,
  }));
  return { id: `${name}/${stage}`, stack: name, stage, app, resources };
}

const web = (name: string, stage: string, hoursAgo: number, extra: Row[] = [], kept = false): Stack => stack(name, stage, hoursAgo, [
  ["DB", "Cloudflare.D1.Database", ["Worker"], { kept, name: `${name}-db` }],
  ["Assets", "Cloudflare.R2.Bucket", ["Worker"], { kept }],
  ["Sessions", "Cloudflare.KV.Namespace", ["Worker"]],
  ...extra,
  ["Worker", "Cloudflare.Worker", ["Route"], { name, url: `https://${name}.example.workers.dev/` }],
  ["Route", "Cloudflare.DNS", []],
]);

export function demoFleet(): Fleet {
  const stacks: Stack[] = [
    web("eqosys", "prod", 30, [["Tokens", "Cloudflare.DurableObject", ["Worker"]]], true),
    web("eqosys", "preview", 2),
    web("codesplitter", "prod", 70, [
      ["Repos", "Cloudflare.DurableObject", ["Worker", "Jobs"]],
      ["Jobs", "Cloudflare.Queue", ["Worker"]],
      ["Checks", "Cloudflare.Workflow", ["Worker"]],
      ["Sandbox", "Cloudflare.Container", ["Worker"]],
    ], true),
    web("qollab", "prod", 12, [["Rooms", "Cloudflare.DurableObject", ["Worker"]], ["Hub", "Cloudflare.DurableObject", ["Worker", "Rooms"]]]),
    stack("cron-swanson", "prod", 200, [
      ["Volume", "Railway.Volume", ["App"], { kept: true }],
      ["Project", "Railway.Project", ["App", "Volume"]],
      ["App", "Railway.Service", [], { name: "cron-swanson" }],
    ]),
    stack("box", "prod", 5, [
      ["Server", "Hetzner.Server", ["Caddy", "App_qcrm", "App_geoboxq"], { kept: true, name: "rusty-box-1" }],
      ["Caddy", "Hetzner.Service", ["App_qcrm", "App_geoboxq"]],
      ["App_qcrm", "Hetzner.Service", [], { status: "updating" }],
      ["App_geoboxq", "Hetzner.Service", []],
      ["Postgres", "Neon.Branch", ["App_qcrm"], { kept: true }],
    ], "apps/qcrm"),
  ];
  return { version: "demo", at: T0 + 24 * 21 * HOUR, stacks };
}
