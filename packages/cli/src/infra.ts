// `rustybuns infra`: the stack as a graph, from the config alone (no login, no build, nothing read
// from the account). codeSplitter draws it as the infra map; `--json` is what it reads.
//
//   nodes   the Worker, then one per binding that is, or reaches, a resource (secrets and vars are
//           counted on the Worker). `protected`: destroy leaves it (protect.ts).
//   edges   Worker -> binding; a consumed queue points back at the Worker; a Neon-backed
//           Hyperdrive points at its Postgres.

import { workerName, type Binding, type RustyBunsConfig } from "./config.ts";
import { isProtected } from "./protect.ts";

export interface InfraNode {
  id: string;
  kind: string;
  /** What the config calls it: the binding's key. */
  label: string;
  /** What it is called on the account under adopt; Alchemy picks the name otherwise. */
  name?: string;
  protected: boolean;
  /** One short line: dimensions, a cron list, a consumer. */
  note?: string;
}
export interface InfraEdge { from: string; to: string; label?: string }
export interface InfraGraph {
  app: string;
  stage: string;
  mode: "fresh" | "adopt";
  targets: string[];
  nodes: InfraNode[];
  edges: InfraEdge[];
}

/** The name a binding has on the account, when the config gives it one. */
const named = (b: Binding): string | undefined =>
  b.type === "d1" ? b.databaseName : b.type === "r2" ? b.bucketName : b.type === "queue" ? b.queueName
  : b.type === "vectorize" ? b.indexName : b.type === "hyperdrive" ? b.configName : undefined;

/** Bindings that are only configuration on the Worker: counted, not drawn. */
const SETTINGS = new Set(["var", "secret"]);

export function infraGraph(cfg: RustyBunsConfig, stage: string): InfraGraph {
  const bindings = Object.entries(cfg.bindings ?? {});
  const edge = cfg.targets.edge;
  const vars = bindings.filter(([, b]) => b.type === "var").length, secrets = bindings.filter(([, b]) => b.type === "secret").length;
  const nodes: InfraNode[] = [], edges: InfraEdge[] = [];
  const crons = cfg.worker?.crons ?? [], domain = edge?.domain;
  const note = [
    domain ? (Array.isArray(domain) ? domain.join(", ") : domain) : "",
    crons.length ? `${crons.length} cron${crons.length === 1 ? "" : "s"}` : "",
    vars + secrets ? `${vars} var${vars === 1 ? "" : "s"}, ${secrets} secret${secrets === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  if (cfg.worker || edge) nodes.push({ id: "worker", kind: "worker", label: workerName(cfg), name: workerName(cfg), protected: false, ...(note && { note }) });
  for (const [key, b] of bindings) {
    if (SETTINGS.has(b.type)) continue;
    const n: InfraNode = { id: key, kind: b.type, label: key, protected: isProtected(b) };
    const on = named(b);
    if (on) n.name = on;
    if (b.type === "vectorize") n.note = `${b.dimensions} dimensions, ${b.metric ?? "cosine"}`;
    else if (b.type === "container") n.note = `${b.instanceType ?? "lite"}, up to ${b.maxInstances ?? 1}`;
    else if (b.type === "queue" && b.consumer !== false && b.producer === false) n.note = "consumed by the Worker";
    nodes.push(n);
    if (nodes[0]?.id === "worker") edges.push(b.type === "queue" && b.producer === false ? { from: key, to: "worker", label: "consumer" } : { from: "worker", to: key });
    if (b.type === "hyperdrive" && b.origin?.neon) {
      const pg = `${key}:postgres`;
      nodes.push({ id: pg, kind: "postgres", label: b.origin.neon.branch ?? b.origin.neon.project ?? "Neon", protected: false, note: "Neon Postgres" });
      edges.push({ from: key, to: pg });
    }
  }
  const targets = [edge || !cfg.targets.box ? "edge" : "", cfg.targets.box ? "box" : "", cfg.targets.desktop ? "desktop" : ""].filter(Boolean);
  return { app: cfg.name, stage, mode: edge?.adopt ? "adopt" : "fresh", targets, nodes, edges };
}

/** The graph as the plain text `rustybuns infra` prints without --json. */
export function infraText(g: InfraGraph): string {
  const lines = [`${g.app} · stage ${g.stage} · ${g.mode.toUpperCase()} · ${g.targets.join(" + ")}`];
  for (const n of g.nodes) {
    const tag = n.protected ? "[KEPT]   " : n.kind === "worker" ? "         " : "[REMOVED]";
    lines.push(`  ${tag} ${n.kind.padEnd(14)} ${n.label}${n.name && n.name !== n.label ? ` (${n.name})` : ""}${n.note ? `  ${n.note}` : ""}`);
  }
  return lines.join("\n");
}
