// A plain react-dom app, written for a browser. Nothing here knows about the engine.
import { useState } from "react";

export function App() {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  return (
    <main style={{ padding: 16, fontFamily: "system-ui" }}>
      <h1>Shopping</h1>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an item" />
      <button disabled={!draft} onClick={() => { setItems([...items, draft]); setDraft(""); }}>Add</button>
      <ul>
        {items.map((item, i) => (
          <li key={item}>
            {item} <button onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ul>
      <p className={items.length ? "count" : "count empty"}>{items.length} items</p>
    </main>
  );
}
