// OBS (#6474): obs-websocket v5, from the page straight to OBS on this computer (Tools > WebSocket Server Settings).
// Only what a show needs: the scenes, switching one, and starting and stopping the stream and the recording.
import { arr, bool, check, int, obj, opt, raw, str, type Of } from "@rustybuns/util/guard";
import { b64 } from "@rustybuns/util/bytes";

export const OBS_URL = "ws://127.0.0.1:4455";

const Envelope = obj({ op: int(0, 20), d: raw });
const Hello = obj({ rpcVersion: int(1, 1000), authentication: opt(obj({ challenge: str(200), salt: str(200) })) });
const Response = obj({ requestType: str(100), requestId: str(100), requestStatus: obj({ result: bool(false), code: int(0, 10_000), comment: opt(str(500)) }), responseData: opt(raw) });
const Event = obj({ eventType: str(100) });
const SceneList = obj({ currentProgramSceneName: opt(str(300)), scenes: arr(obj({ sceneName: str(300) }), 500) });
export type ObsMessage =
  | { op: "hello"; d: Of<typeof Hello> }
  | { op: "identified" }
  | { op: "event"; type: string }
  | { op: "response"; d: Of<typeof Response> };

/** One message from OBS, or null for one this doesn't read. */
export function parseObs(text: string): ObsMessage | null {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const m = check(Envelope, json);
  if (!m) return null;
  if (m.op === 0) { const d = check(Hello, m.d); return d && { op: "hello", d }; }
  if (m.op === 2) return { op: "identified" };
  if (m.op === 5) { const d = check(Event, m.d); return d && { op: "event", type: d.eventType }; }
  if (m.op === 7) { const d = check(Response, m.d); return d && { op: "response", d }; }
  return null;
}

const hash = async (s: string) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
/** obs-websocket's answer to its challenge: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export const obsAuth = async (password: string, salt: string, challenge: string) => hash((await hash(password + salt)) + challenge);

/** The reply to Hello. Events: only the scene list's (4), so a new or switched scene shows. */
export async function identify(hello: Of<typeof Hello>, password: string): Promise<string> {
  const a = hello.authentication;
  return JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 4, ...(a ? { authentication: await obsAuth(password, a.salt, a.challenge) } : {}) } });
}
export const obsRequest = (requestType: string, requestId: string, requestData?: Record<string, string>) =>
  JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } });

export interface Obs { scenes(): string[]; current(): string | null; send(type: string, data?: Record<string, string>): void; close(): void }

/** Connect to OBS. `changed` runs when the scenes do; `said` hears what went wrong; `closed` when the line drops. */
export function connectObs(url: string, password: string, on: { changed(): void; said(why: string): void; closed(): void }): Promise<Obs> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(url, "obswebsocket.json");
    let scenes: string[] = [], current: string | null = null, next = 0, ready = false;
    const send = (type: string, data?: Record<string, string>) => { if (ws.readyState === WebSocket.OPEN) ws.send(obsRequest(type, String(++next), data)); };
    const obs: Obs = { scenes: () => scenes, current: () => current, send, close: () => ws.close() };
    const timer = setTimeout(() => ws.close(), 8000);
    ws.onmessage = async (e) => {
      const m = parseObs(String(e.data));
      if (!m) return;
      if (m.op === "hello") ws.send(await identify(m.d, password));
      else if (m.op === "identified") { ready = true; clearTimeout(timer); send("GetSceneList"); done(obs); }
      else if (m.op === "event") { if (m.type.includes("Scene")) send("GetSceneList"); }
      else if (!m.d.requestStatus.result) on.said(`OBS: ${m.d.requestType}: ${m.d.requestStatus.comment ?? `refused (${m.d.requestStatus.code})`}`);
      else if (m.d.requestType === "GetSceneList") {
        const list = check(SceneList, m.d.responseData);
        if (!list) return;
        // OBS lists them bottom first
        scenes = list.scenes.map((s) => s.sceneName).reverse();
        current = list.currentProgramSceneName ?? null;
        on.changed();
      }
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (ready) on.closed();
      else fail(new Error(e.code === 4009 ? "OBS didn't take that password" : "No OBS there: is its WebSocket server on?"));
    };
  });
}
