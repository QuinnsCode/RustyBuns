// The issues board's 📥 Open column, new issues first: an issue the office already handed to a worker (📋 queued, or
// 🔀 a PR open for it) sinks below the ones nobody has picked up, so the new ones are what you see. The column keeps
// GitHub's order (newest first) otherwise, and 🚧 In progress is untouched.

/** The client bundle's issue columns (Sm in assets/ask-*.js), minified; r is the client's store. */
export function openNewFirstClient(js: string) {
  const open = "items:t.filter(e=>!n.includes(e))},{key:`progress`";
  if (js.split(open).length !== 2) throw new Error(`Agent Office changed: patch target moved in assets/ask-*.js: ${open}`);
  return js.replace(open, () =>
    "items:t.filter(e=>!n.includes(e)).sort((e,t)=>+!!r.taskForIssue(e.number)-+!!r.taskForIssue(t.number))},{key:`progress`");
}
