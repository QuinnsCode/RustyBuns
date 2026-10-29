// The sesh's chat: who said what, kept in the room beside the groove. Each person picks their
// own name; the sesh's host (the World's maker key) can delete a line, which stays in its place marked deleted so the
// log doesn't jump under anyone's eyes. Pure, so the room, the page and the tests share it.
import { arr, bool, check, int, obj, oneOf, opt, rec, str, type Guard } from "@rustybuns/util/guard";

/** Lines a room keeps; older ones fall off the top. */
export const KEEP = 300;
export const LINE_MAX = 500;
export const NAME_MAX = 24;
/** Names a room remembers; past it, names nobody's lines use are let go. */
export const NAMES_MAX = KEEP + 64;

/** `from` is a person's id: a hash of the key their browser keeps, never the key itself. */
export type Line = { id: number; from: string; at: number; text: string; deleted?: boolean };
export type Chat = { lines: Line[]; names: Record<string, string>; next: number };
export const empty = (): Chat => ({ lines: [], names: {}, next: 1 });

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
export const cleanName = (s: string) => clean(s, NAME_MAX);

export function rename(c: Chat, who: string, name: string): Chat {
  const n = cleanName(name);
  if (!n || c.names[who] === n) return c;
  let names = { ...c.names, [who]: n };
  if (Object.keys(names).length > NAMES_MAX) {
    const keep = new Set([who, ...c.lines.map((l) => l.from)]);
    names = Object.fromEntries(Object.entries(names).filter(([k]) => keep.has(k)));
  }
  return { ...c, names };
}

/** A new line, or the same chat if there's nothing to say. */
export function say(c: Chat, who: string, text: string, at: number): Chat {
  const t = clean(text, LINE_MAX);
  if (!t) return c;
  const lines = [...c.lines, { id: c.next, from: who, at, text: t }];
  return { ...c, lines: lines.slice(-KEEP), next: c.next + 1 };
}

/** The line keeps its place, its words go. Only the sesh's host may ask: the World checks that. */
export function unsay(c: Chat, id: number): Chat {
  const i = c.lines.findIndex((l) => l.id === id && !l.deleted);
  if (i < 0) return c;
  const lines = c.lines.slice();
  lines[i] = { id, from: lines[i].from, at: lines[i].at, text: "", deleted: true };
  return { ...c, lines };
}

/** How a person shows: their name, or a short tag from their id until they pick one. */
export const nameOf = (c: Pick<Chat, "names">, who: string) => c.names[who] ?? `guest ${who.slice(0, 4)}`;

const tag = <T extends string>(t: T) => oneOf([t]);
const ID = str(64, { re: /^[0-9a-f]{8,64}$/ });
const LINE: Guard<Line> = (v) => {
  const l = obj({ id: int(1, Infinity), from: ID, at: int(0, Infinity), text: str(LINE_MAX, { min: 0 }), deleted: opt(bool()) })(v);
  return l.deleted ? { id: l.id, from: l.from, at: l.at, text: "", deleted: true } : { id: l.id, from: l.from, at: l.at, text: l.text };
};
const NAMES = rec(str(NAME_MAX), NAMES_MAX);
/** A stored chat read back, or an empty one if it isn't one. */
export const sanitizeChat = (v: unknown): Chat => check(obj({ lines: arr(LINE, KEEP, { drop: true }), names: NAMES, next: int(1, Infinity) }), v) ?? empty();

/**
 * Page to room. `hello` says who this is (the browser's key, hashed in the room) and their name;
 * the rest only count after it.
 */
export type ChatClient =
  | { t: "hello"; key: string; name: string } | { t: "say"; text: string }
  | { t: "rename"; name: string } | { t: "unsay"; id: number };
/** Room to page: the whole chat (and which id is you), then one line, a rename or a deletion at a time. */
export type ChatServer =
  | { t: "chat"; lines: Line[]; names: Record<string, string>; you: string }
  | { t: "line"; line: Line } | { t: "named"; who: string; name: string } | { t: "unsaid"; id: number };

const KEY = str(64, { re: /^[0-9a-f]{32,64}$/ });
const CLIENT: Guard<ChatClient>[] = [
  obj({ t: tag("hello"), key: KEY, name: str(200, { min: 0 }) }), obj({ t: tag("say"), text: str(LINE_MAX * 4) }),
  obj({ t: tag("rename"), name: str(200) }), obj({ t: tag("unsay"), id: int(1, Infinity) }),
];
const SERVER: Guard<ChatServer>[] = [
  obj({ t: tag("chat"), lines: arr(LINE, KEEP, { drop: true }), names: NAMES, you: ID }),
  obj({ t: tag("line"), line: LINE }), obj({ t: tag("named"), who: ID, name: str(NAME_MAX) }), obj({ t: tag("unsaid"), id: int(1, Infinity) }),
];
export const decodeChatClient = (v: unknown): ChatClient | null => CLIENT.reduce<ChatClient | null>((got, g) => got ?? check(g, v), null);
export const decodeChatServer = (v: unknown): ChatServer | null => SERVER.reduce<ChatServer | null>((got, g) => got ?? check(g, v), null);

/** A person's id from their key: the room and the profile store both use it, and neither keeps the key. */
export async function personId(key: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fm-daw:${key}`)));
  return Array.from(d.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a page knows of the chat: the room's lines and names, and which id is you. */
export type ChatView = { lines: Line[]; names: Record<string, string>; you: string | null };
export const noChat = (): ChatView => ({ lines: [], names: {}, you: null });

/** The page's chat after one message from the room. */
export function heard(v: ChatView, m: ChatServer): ChatView {
  switch (m.t) {
    case "chat": return { lines: m.lines, names: m.names, you: m.you };
    case "line": return v.lines.some((l) => l.id === m.line.id) ? v : { ...v, lines: [...v.lines, m.line].slice(-KEEP) };
    case "named": return { ...v, names: { ...v.names, [m.who]: m.name } };
    case "unsaid": return { ...v, lines: v.lines.map((l) => (l.id === m.id ? { id: l.id, from: l.from, at: l.at, text: "", deleted: true } : l)) };
  }
}
