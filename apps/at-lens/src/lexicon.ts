// Writing: our own record type, and what we ask a person's data server to let us do with it. The page signs in with
// atproto OAuth (src/signin.ts), the Worker publishes the client metadata below, and the Lexicon itself is
// public/lexicons/dev.rustybuns.lens.status.json. Specs: https://atproto.com/guides/oauth, https://atproto.com/specs/lexicon,
// https://atproto.com/specs/permission.

/** Our record type. The NSID's authority is lens.rustybuns.dev, reversed: a domain whose DNS can publish the schema. */
export const STATUS = "dev.rustybuns.lens.status";

/** Sign-in asks for nothing but creating records in our own collection: not posts, likes, follows or anything else. */
export const SCOPE = `atproto repo:${STATUS}?action=create`;

/** The Lexicon's limits on `text`, kept here so the page refuses what the data server would. */
export const MAX_GRAPHEMES = 100, MAX_BYTES = 1000;

export interface Status { $type: typeof STATUS; text: string; createdAt: string }

const graphemes = (s: string) => [...new Intl.Segmenter().segment(s)].length;

/** A status record for `text`, or why it can't be one. */
export function statusRecord(text: string, now = new Date()): Status | { error: string } {
  const t = text.trim();
  if (!t) return { error: "Write something first." };
  if (graphemes(t) > MAX_GRAPHEMES || new TextEncoder().encode(t).byteLength > MAX_BYTES) return { error: `${MAX_GRAPHEMES} characters at most.` };
  return { $type: STATUS, text: t, createdAt: now.toISOString() };
}

/**
 * The OAuth client metadata for a deployed AT Lens at `origin`. Its client_id is its own URL, which the person's
 * authorization server fetches, so the page and the Worker must agree on every field: both build it here.
 */
export const clientMetadata = (origin: string) => ({
  client_id: `${origin}/client-metadata.json`,
  client_name: "AT Lens",
  client_uri: `${origin}/`,
  redirect_uris: [`${origin}/`] as [string],
  scope: SCOPE,
  grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
  response_types: ["code"] as ["code"],
  token_endpoint_auth_method: "none" as const,
  application_type: "web" as const,
  dpop_bound_access_tokens: true,
});
