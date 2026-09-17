import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RunFrame } from "@tscircuit/runframe/runner";
import { evalWorkerUrl } from "./evalWorker.ts";
import { api, type Status } from "./api.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { AnalysisPanel } from "./AnalysisPanel.tsx";

type Files = Awaited<ReturnType<typeof api.files>>;

export function Workspace({ status, onClose }: { status: Status; onClose: () => void }) {
  const [files, setFiles] = useState<Files | null>(null);
  const [board, setBoard] = useState<string | null>(status.project?.entry ?? null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "code">("board");
  const [circuitJson, setCircuitJson] = useState<unknown[] | null>(null);
  const [renderedAt, setRenderedAt] = useState(0);
  const dirty = useRef<string | null>(null);

  const load = useCallback(() => api.files().then((f) => {
    setFiles(f);
    setBoard((b) => (b && f.fsMap[b] !== undefined ? b : f.entry));
  }), []);
  useEffect(() => { load(); }, [load]);

  // Files changed on disk (your editor, git, anything): reload, debounced.
  useEffect(() => {
    const es = new EventSource("/api/project/events");
    let t: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type !== "changed" || ev.path === dirty.current) return;
      clearTimeout(t);
      t = setTimeout(load, 150);
    };
    return () => { clearTimeout(t); es.close(); };
  }, [load]);

  // RunFrame re-renders when fsMap identity changes; keep it stable per load.
  const fsMap = useMemo(() => files?.fsMap ?? {}, [files]);

  if (!files) return <div className="loading">Opening {status.project?.name}…</div>;
  const others = files.files.filter((f) => !files.boards.includes(f));

  return (
    <div className="workspace">
      <aside className="files">
        <header>
          <strong title={files.dir}>{files.name}</strong>
          <button className="link" onClick={onClose}>Switch</button>
        </header>
        <h3>Boards</h3>
        <ul className="plain">
          {files.boards.map((b) => (
            <li key={b}>
              <button className={`file ${b === board ? "active" : ""}`} onClick={() => { setBoard(b); setTab("board"); }}>{b}</button>
            </li>
          ))}
          {files.boards.length === 0 && <li className="muted">No <code>*.circuit.tsx</code> files.</li>}
        </ul>
        <h3>Files</h3>
        <ul className="plain">
          {[...files.boards, ...others].map((f) => (
            <li key={f}>
              <button className={`file ${tab === "code" && f === openFile ? "active" : ""}`} onClick={() => { setOpenFile(f); setTab("code"); }}>{f}</button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="center">
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "board"} onClick={() => setTab("board")}>Board{board ? `: ${board}` : ""}</button>
          <button role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")} disabled={!openFile}>Code{openFile ? `: ${openFile}` : ""}</button>
        </nav>
        <div className="pane" hidden={tab !== "board"}>
          {board ? (
            <RunFrame
              key={`${files.dir}:${board}`}
              fsMap={fsMap}
              // Scripts that call circuit.add(...) are entrypoints; files that
              // export a component are rendered through mainComponentPath.
              {...(/\bcircuit\.add\(/.test(fsMap[board] ?? "") ? { entrypoint: board } : { mainComponentPath: board })}
              evalWebWorkerBlobUrl={evalWorkerUrl}
              forceLatestEvalVersion={false}
              showRunButton={false}
              showFileMenu={false}
              defaultActiveTab="pcb"
              onRenderFinished={({ circuitJson }) => { setCircuitJson(circuitJson); setRenderedAt(Date.now()); }}
            />
          ) : <p className="empty">Create a <code>.circuit.tsx</code> file in this folder to see a board.</p>}
        </div>
        {tab === "code" && openFile && (
          <CodeEditor
            key={openFile}
            path={openFile}
            text={files.fsMap[openFile] ?? ""}
            onDirty={(d) => { dirty.current = d ? openFile : null; }}
            onSave={async (text) => { await api.save(openFile, text); dirty.current = null; await load(); }}
          />
        )}
      </section>

      <AnalysisPanel native={status.native} board={board} circuitJson={circuitJson} renderedAt={renderedAt} />
    </div>
  );
}
