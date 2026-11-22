// The home's rows (pages.tsx Library) fold shut on their headers. Each toggle posts every row that is folded now to /do/fold,
// which keeps them on the person's hub, so the next page, on any device, comes out already folded. Signed out, there is no hub
// and the post is refused: the rows still fold, they just start open next time.

/** Watch the home's rows, and save which are folded each time one opens or shuts. Returns how many rows it watches. */
export function mountFolds(doc: Document, post: (body: FormData) => Promise<unknown> = (body) => fetch("/do/fold", { method: "POST", credentials: "same-origin", body })) {
  const rows = [...doc.querySelectorAll<HTMLDetailsElement>("details[data-row]")];
  // A browser fires toggle for a row drawn open too, once the page loads: only a real change posts.
  const folded = () => rows.filter((d) => !d.open).map((d) => d.dataset.row!);
  let sent = folded().join("\n");
  const save = () => {
    const now = folded();
    if (now.join("\n") === sent) return;
    sent = now.join("\n");
    const body = new FormData();
    for (const r of now) body.append("row", r);
    void post(body).catch(() => {});
  };
  for (const d of rows) d.addEventListener("toggle", save);
  return rows.length;
}
