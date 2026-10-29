// Signing in and writing, all in the page: @atproto/oauth-client-browser runs PAR, PKCE and DPoP against the
// person's own authorization server and keeps the DPoP key and tokens in this origin's IndexedDB. Deployed, the
// client_id is the Worker's /client-metadata.json; on 127.0.0.1 it is a loopback client the spec lets run without one.
import { BrowserOAuthClient, buildAtprotoLoopbackClientMetadata, OAuthCallbackError, type OAuthSession } from "@atproto/oauth-client-browser";
import { check, obj, opt, str } from "@rustybuns/util/guard";
import { clientMetadata, SCOPE, STATUS, type Status } from "./lexicon.ts";

export type { OAuthSession };

const loopback = location.hostname === "127.0.0.1" || location.hostname === "[::1]";

const client = new BrowserOAuthClient({
  clientMetadata: loopback
    ? buildAtprotoLoopbackClientMetadata({ scope: SCOPE, redirect_uris: [`${location.origin}/`] })
    : clientMetadata(location.origin),
  // Handles resolve through our own Worker (the same walk the page shows), not a third party's resolver.
  handleResolver: location.origin,
});

/**
 * The signed-in session, restored or just back from the authorization server. Back from there, signed in or not
 * (you can say no), `back` is the URL you left from.
 */
export async function restore(): Promise<{ session: OAuthSession | null; back: string | null; error?: string }> {
  try {
    const r = await client.init();
    return { session: r?.session ?? null, back: r && "state" in r && typeof r.state === "string" ? r.state : null };
  } catch (e) {
    return { session: null, back: e instanceof OAuthCallbackError ? e.state ?? "" : null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Off to the person's authorization server; `back` is the view to land on again. */
export const signIn = (handle: string, back: string) => client.signInRedirect(handle, { scope: SCOPE, state: back });

const Created = obj({ uri: str(8192), cid: str(200) });
const XrpcError = obj({ error: opt(str(200)), message: opt(str(2000)) });

/** Create the record in the person's own repo, on their own data server, with their DPoP-bound token. */
export async function write(session: OAuthSession, record: Status) {
  const res = await session.fetchHandler("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: session.did, collection: STATUS, record }),
  });
  const v: unknown = await res.json().catch(() => null);
  if (!res.ok) { const e = check(XrpcError, v); throw new Error(e?.message ?? e?.error ?? `your data server said ${res.status}`); }
  const got = check(Created, v);
  if (!got) throw new Error("your data server sent something this page doesn't know");
  return got;
}
