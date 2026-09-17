import { useState } from "react";

// Deliberately small: a textarea with save. Your own editor works too;
// the preview follows the files on disk either way.
export function CodeEditor({ path, text, onSave, onDirty }: {
  path: string; text: string; onSave: (text: string) => Promise<void>; onDirty: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(text);
  const [state, setState] = useState<"clean" | "dirty" | "saving" | "error">("clean");
  const save = async () => {
    setState("saving");
    try { await onSave(value); setState("clean"); onDirty(false); } catch { setState("error"); }
  };
  return (
    <div className="editor">
      <div className="editor-bar">
        <code>{path}</code>
        <span className={`save-state ${state}`}>{{ clean: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed. Check the file is writable." }[state]}</span>
        <button className="primary" onClick={save} disabled={state === "clean" || state === "saving"}>Save</button>
      </div>
      <textarea
        spellCheck={false}
        value={value}
        aria-label={`Contents of ${path}`}
        onChange={(e) => { setValue(e.target.value); if (state !== "dirty") { setState("dirty"); onDirty(true); } }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget, s = t.selectionStart;
            const next = value.slice(0, s) + "  " + value.slice(t.selectionEnd);
            setValue(next);
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
            if (state !== "dirty") { setState("dirty"); onDirty(true); }
          }
        }}
      />
    </div>
  );
}
