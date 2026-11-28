// `local()`: the app in this process, no browser and no network. The real relay (the MCP and HTTP doors) with a
// stand-in page behind it that does what the open page does with a call: the same check (decode), the same change and
// undo history (step), the same answers (answers.ts). The sealed frame doesn't run, so page_read hears no errors.
import { parseJson } from "@rustybuns/util/http";
import { changed, fileRead, looked } from "../src/answers.ts";
import { type Page, starter } from "../src/page.ts";
import { step } from "../src/ProfilePage.ts";
import { linksFor, Relay } from "../src/relay.ts";
import { decode, decodeReadFile, READ, READ_FILE, ToPage, TOOLS } from "../src/tools.ts";
import type { Rpc } from "../../../scripts/mcp-session.ts";

export function local() {
  const links = linksFor("http://localhost:4799", "testroom0001");
  let model: { page: Page; past: readonly Page[] } = { page: starter, past: [] };
  const answer = (name: string, args: unknown): { ok: boolean; result: unknown; error?: string } => {
    if (name === READ.name) return { ok: true, result: looked(model.page, []) };
    if (name === READ_FILE.name) {
      const r = fileRead(model.page, decodeReadFile(args).path);
      return { ok: !("error" in r), result: r, error: "error" in r ? r.error : undefined };
    }
    const out = step(model, decode(TOOLS.find((t) => t.name === name)!, args));
    model = out.model;
    return { ok: out.error === null, result: changed(out.error, model.page), error: out.error ?? undefined };
  };
  const relay: Relay = new Relay(() => (frame) => {
    const m = ToPage(parseJson(frame));
    queueMicrotask(() => relay.heard({ t: "reply", id: m.id, ...answer(m.name, m.args) }));
  });
  let id = 0;
  const rpc: Rpc = async (method, params) => (await relay.mcp({ jsonrpc: "2.0", id: ++id, method, params }, links)).json();
  return { rpc, page: () => model.page };
}
