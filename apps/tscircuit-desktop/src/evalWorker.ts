// Starts tscircuit's evaluator worker with requests to EasyEDA routed through
// the desktop host. EasyEDA's API only answers pages on tscircuit.com, so
// from 127.0.0.1 the browser blocks it (CORS); the host has no such limit.
//
// Two tiny module blobs, imported in order: the fetch redirect, then the
// unchanged evaluator. The redirect runs first, so the evaluator only ever
// sees the patched fetch.
import evalBlobUrl from "@tscircuit/eval/blob-url";

const moduleUrl = (code: string) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

const redirect = moduleUrl(`
const proxy = ${JSON.stringify(`${location.origin}/api/proxy/`)};
const routed = (host) => host === "easyeda.com" || host.endsWith(".easyeda.com");
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const req = input instanceof Request ? input : null;
  let url;
  try { url = new URL(req ? req.url : String(input)); } catch { return realFetch(input, init); }
  if (!routed(url.hostname)) return realFetch(input, init);
  const target = proxy + url.hostname + url.pathname + url.search;
  return realFetch(req ? new Request(target, req) : target, init);
};
`);

export const evalWorkerUrl = moduleUrl(`import ${JSON.stringify(redirect)};\nimport ${JSON.stringify(evalBlobUrl)};\n`);
