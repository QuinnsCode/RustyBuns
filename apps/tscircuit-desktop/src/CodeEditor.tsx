import { useEffect, useRef, useState } from "react";

// Deliberately small: a textarea with save. Your own editor works too;
// the preview follows the files on disk either way.
export function CodeEditor({ path, text, onSave, onDirty }: {
  path: string; text: string; onSave: (text: string) => Promise<void>; onDirty: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(text);
  const [state, setState] = useState<"clean" | "dirty" | "saving" | "error" | "conflict">("clean");
  const disk = useRef(text);

  // The file changed on disk (another editor, git). Follow it when there's
  // nothing unsaved here; otherwise say so instead of silently overwriting it.
  useEffect(() => {
    if (text === disk.current) return;
    disk.current = text;
    if (state === "clean") setValue(text);
    else if (text !== value) setState("conflict");
  }, [text]);

  const edited = (next: string) => {
    setValue(next);
    if (state === "clean" || state === "error") { setState("dirty"); onDirty(true); }
  };
  const save = async () => {
    setState("saving");
    try { await onSave(value); disk.current = value; setState("clean"); onDirty(false); } catch { setState("error"); }
  };
  const reload = () => { setValue(disk.current); setState("clean"); onDirty(false); };

  return (
    <div className="editor">
      <div className="editor-bar">
        <code>{path}</code>
        <span className={`save-state ${state}`}>{{ clean: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed. Check the file is writable.", conflict: "Changed on disk since you started editing" }[state]}</span>
        {state === "conflict" && <button onClick={reload}>Discard mine, load disk</button>}
        <button className="primary" onClick={save} disabled={state === "clean" || state === "saving"}>{state === "conflict" ? "Overwrite" : "Save"}</button>
      </div>
      <textarea
        spellCheck={false}
        value={value}
        aria-label={`Contents of ${path}`}
        onChange={(e) => edited(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget, s = t.selectionStart;
            edited(value.slice(0, s) + "  " + value.slice(t.selectionEnd));
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }
        }}
      />
    </div>
  );
}
