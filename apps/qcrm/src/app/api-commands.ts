// Every API operation as a page command: the same tools the MCP server lists (mcp-tools.ts), so whatever an agent
// can call from outside, a person can press in Cmd/Ctrl-K and an agent in the browser can call through WebMCP, with
// the open org filled in and only what this person's role reaches. One list, four doors (MCP, WebMCP, palette, CLI).
//
// In the palette a tool with one input asks for it; one with several asks for its arguments as one JSON line (the
// row shows what it expects and whether the line parses); a risky one with nothing to ask asks for "yes" first.
// A write that lands fires `qcrm-changed`, so the open table reloads.

import { raw, rec } from "@rustybuns/util/guard";
import type { Command, InputSchema } from "@rustybuns/util/commands";
import { esc } from "@rustybuns/util";
import { reaches, toRequest, tools, type Tool } from "../mcp-tools.ts";

const ICONS: Record<string, string> = {
  Account: "users", Org: "building", Members: "users", Contact: "users", Company: "building", Deal: "badge-dollar-sign", Activity: "activity",
  Sync: "refresh-cw", Webhooks: "webhook", Keys: "key-round", Scripts: "scroll-text", Files: "upload", Plugins: "plug", Admin: "shield-check",
};
const Args = rec(raw);
const CONFIRM = { type: "string", description: 'type "yes": this one can\'t be undone or changes who can get in' };

/** How the palette's one line becomes this tool's arguments. */
type Ask = { kind: "none" } | { kind: "one"; key: string } | { kind: "json"; keys: string[] } | { kind: "confirm" };

function askFor(t: Tool, inputs: string[], required: string[]): Ask {
  if (!required.length) return t.risky ? { kind: "confirm" } : { kind: "none" };
  if (inputs.length === 1 && required[0] !== "body") return { kind: "one", key: required[0]! };
  return { kind: "json", keys: inputs };
}

const described = (schema: object | undefined) => { const d: unknown = schema && Reflect.get(schema, "description"); return typeof d === "string" && d ? d : null; };

/** The answer: JSON when it is, the text otherwise; a failure throws its message, as the palette shows errors. */
async function answer(res: Response): Promise<unknown> {
  const text = await res.text();
  let out: unknown = text;
  try { out = JSON.parse(text); } catch { /* a download or plain text */ }
  if (!res.ok) throw new Error(typeof out === "object" && out && "error" in out ? String(Reflect.get(out, "error")) : `${res.status}`);
  return out;
}

export function apiCommands(org: string, role: string): Command[] {
  return tools({ cookieOnly: true }).filter((t) => !t.open && reaches(role, t.role) && (t.tag !== "Admin" || role === "super_admin")).map((t): Command => {
    const props: Record<string, object | undefined> = { ...t.inputSchema.properties };
    delete props.org;
    const required: string[] = (t.inputSchema.required ?? []).filter((k: string) => k !== "org");
    const ask = askFor(t, Object.keys(props), required);
    // A risky tool with nothing else to ask takes a "yes" from either door.
    const inputSchema: InputSchema = ask.kind === "confirm"
      ? { type: "object", properties: { confirm: CONFIRM }, required: ["confirm"] }
      : { type: "object", properties: ask.kind === "one" ? { [ask.key]: props[ask.key], ...props } : props, ...(required.length && { required }) };
    return {
      name: `crm_${t.name}`, title: t.title, description: `${t.description} The open org (${org}) is filled in.`,
      group: t.tag, icon: ICONS[t.tag] ?? "info", note: `${t.method} ${t.path.replace("/orgs/{org}", "") || "/"}`,
      inputSchema, annotations: t.annotations,
      ...(t.method !== "GET" && { answers: true }),
      ...(ask.kind === "one" && { ask: described(props[ask.key]) ?? ask.key }),
      ...(ask.kind === "confirm" && { ask: `Type yes to ${t.title.charAt(0).toLowerCase()}${t.title.slice(1)}` }),
      ...(ask.kind === "json" && {
        ask: `Arguments as JSON: ${ask.keys.join(", ")}`,
        preview: (line: string) => {
          try { const v = Args(JSON.parse(line)); return { html: `${esc(t.title)}: ${esc(Object.keys(v).join(", ") || "no arguments")}, press Enter` }; }
          catch { return { html: `JSON with ${esc(ask.keys.join(", "))}`, bad: true }; }
        },
      }),
      execute: async (input, via) => {
        let a = Args(input ?? {});
        // The palette hands its line as the first property; a JSON ask means the line is every argument.
        if (via === "palette" && ask.kind === "json") a = Args(JSON.parse(String(Object.values(a)[0] ?? "{}")));
        if (ask.kind === "confirm" && a.confirm !== "yes") throw new Error('not done: confirm with "yes"');
        const req = toRequest(t, { ...a, org }, "", {});
        if (typeof req === "string") throw new Error(req);
        const out = await answer(await fetch(req, { credentials: "same-origin" }));
        if (t.method !== "GET") window.dispatchEvent(new CustomEvent("qcrm-changed", { detail: { tool: t.name } }));
        return out;
      },
    };
  });
}
