import { useEffect, useState, type FormEvent } from "react";
import { about, summarize } from "../actions/python.ts";
import type { About, Summary } from "../shapes.ts";

const words = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [python, setPython] = useState<About>();
  const [text, setText] = useState("3, 1, 4, 1, 5, 9, 2, 6");
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState("");

  useEffect(() => { about().then(setPython, (e) => setError(words(e))); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setSummary(await summarize(text.split(/[\s,]+/).filter(Boolean).map(Number)));
    } catch (err) {
      setSummary(undefined);
      setError(words(err));
    }
  }

  return (
    <main>
      <h1>Python + React</h1>
      <p>{python ? `Python ${python.version}, running inside the app.` : "Starting Python…"}</p>
      <form onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Numbers" />
        <button type="submit" data-cmd="summarize">Summarize</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {summary && (
        <dl>
          {Object.entries(summary).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{Number(v.toFixed(4))}</dd></div>)}
        </dl>
      )}
    </main>
  );
}
