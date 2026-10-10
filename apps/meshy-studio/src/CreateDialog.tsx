// Make new work without a drawing: a Text to 3D card, or concept art from Text to Image /
// Image to Image (it lands in 000 as new cards; multi-view lands as one multi-image card).
import { useEffect, useState } from "react";
import { scrimProps } from "./scrim.ts";
import { aspectRatios, checkConcept, estimateConcept, IMAGE_MODELS, type ConceptParams, type ImageModel } from "../engine/ops.ts";
import { api, imageUrl, type Card, type Summary } from "./api.ts";
import type { SendAsk } from "./Confirm.tsx";

type Tab = "text-to-3d" | "text-to-image" | "image-to-image";

export function CreateDialog({ sum, folder, references, initial, onClose, onAsk, onSummary }: {
  sum: Summary; folder: string; references: Card[]; initial?: Tab;
  onClose: () => void; onAsk: (a: SendAsk) => void; onSummary: (s: Summary) => void;
}) {
  const refs = references.filter((c) => c.source !== "text").slice(0, 5);
  const [tab, setTab] = useState<Tab>(initial ?? (refs.length ? "image-to-image" : "text-to-3d"));
  const [where, setWhere] = useState(folder);
  const [name, setName] = useState(refs.length ? `${refs[0]!.outName}_v2` : "");
  const [prompt, setPrompt] = useState("");
  const [p, setP] = useState<Omit<ConceptParams, "prompt">>({ ai_model: "nano-banana" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  const kind = tab === "image-to-image" ? "image-to-image" : "text-to-image";
  const params: ConceptParams = { ...p, prompt };
  const problems = tab === "text-to-3d"
    ? [!prompt.trim() && "Write a prompt.", prompt.length > 800 && "800 characters at most."].filter(Boolean) as string[]
    : checkConcept(kind, params, kind === "image-to-image" ? refs.length : 0);
  const nameOk = /^[^/\\:*?"<>|.][^/\\:*?"<>|]*$/.test(name);
  const cost = tab === "text-to-3d" ? 0 : estimateConcept(kind, p.ai_model);

  const go = async () => {
    if (tab === "text-to-3d") {
      try { onSummary(await api.createText(where, name, prompt)); onClose(); } catch (e) { setError((e as Error).message); }
      return;
    }
    onAsk({
      kind: "spend", title: `${kind === "text-to-image" ? "Text to Image" : "Image to Image"}: ${name}?`,
      rows: [{ label: `${p.ai_model}${p.generate_multi_view ? " · multi-view" : ""}`, n: 1, each: cost }],
      note: p.generate_multi_view ? "Multi-view makes three views of the subject; they land as one multi-image card. Meshy doesn't list a separate price for multi-view." : "The image lands in 000 as a new card, ready to send.",
      run: (credits) => api.concept(kind, params, { folder: where, name, references: kind === "image-to-image" ? refs.map((c) => c.key) : undefined }, credits),
    });
  };

  return (
    <div className="scrim" {...scrimProps(onClose)}>
      <aside className="drawer plate" role="dialog" aria-label="Create">
        <header className="row"><h2>Create</h2><span className="grow" /><button className="ghost small" onClick={onClose}>Close</button></header>
        <div className="kinds">
          <button className={tab === "text-to-3d" ? "on" : ""} onClick={() => setTab("text-to-3d")}>Text to 3D</button>
          <button className={tab === "text-to-image" ? "on" : ""} onClick={() => setTab("text-to-image")}>Concept image</button>
          <button className={tab === "image-to-image" ? "on" : ""} disabled={!refs.length} title={refs.length ? "" : "Select image cards first"} onClick={() => setTab("image-to-image")}>Vary images</button>
        </div>

        <p className="small">{tab === "text-to-3d"
          ? <>A card made from a prompt. It's saved as <code>{name || "<name>"}.prompt.txt</code> in 000, so the name's prefix picks the preset, and size tokens work (<code>char_knight_h1.9</code>). On Send, Meshy makes the shape (5 to 25 credits by model), then refines the texture (10, or 15 at 8k) unless it's a draft.</>
          : tab === "text-to-image" ? "Concept art from a prompt, saved into 000 as a new card. Send it on like any drawing."
          : `New versions of ${refs.length} card image${refs.length === 1 ? "" : "s"} (up to 5 references), saved into 000 as a new card.`}</p>

        {tab === "image-to-image" && <div className="refs">{refs.map((c) => <img key={c.key} src={imageUrl(c.key, c.updatedAt)} alt={c.outName} title={c.outName} />)}</div>}

        <div className="form">
          <div className="field"><span className="flabel">Name</span><span className="fval"><input value={name} placeholder="e.g. item_lantern" onChange={(e) => setName(e.target.value)} /><span className="muted small hint">The filename, so its prefix picks the preset.</span></span></div>
          <div className="field"><span className="flabel">Folder</span><span className="fval"><select value={where} onChange={(e) => setWhere(e.target.value)}>{sum.folders.map((f) => <option key={f} value={f}>{f || "Top folder"}</option>)}</select></span></div>
          <div className="field"><span className="flabel">Prompt</span><span className="fval"><textarea rows={4} maxLength={tab === "text-to-3d" ? 800 : 2000} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder={tab === "image-to-image" ? "What to change, e.g. 'make it rusty, keep the shape'" : "Describe the object"} /></span></div>
          {tab !== "text-to-3d" && <>
            <div className="field"><span className="flabel">Image model</span><span className="fval">
              <select value={p.ai_model} onChange={(e) => { const m = e.target.value as ImageModel; setP({ ...p, ai_model: m, aspect_ratio: p.aspect_ratio && aspectRatios(m).includes(p.aspect_ratio) ? p.aspect_ratio : undefined }); }}>
                {IMAGE_MODELS.map((m) => <option key={m} value={m}>{m} · {estimateConcept(kind, m)} credits</option>)}
              </select></span></div>
            <div className="field"><span className="flabel">Multi-view</span><span className="fval">
              <label className="check"><input type="checkbox" checked={!!p.generate_multi_view} onChange={(e) => setP({ ...p, generate_multi_view: e.target.checked || undefined, aspect_ratio: e.target.checked ? undefined : p.aspect_ratio })} />Several angles of the subject (becomes one multi-image card)</label></span></div>
            <div className="field"><span className="flabel">Aspect ratio</span><span className="fval">
              <select value={p.aspect_ratio ?? ""} disabled={!!p.generate_multi_view} onChange={(e) => setP({ ...p, aspect_ratio: e.target.value || undefined })}>
                <option value="">Default (1:1)</option>{aspectRatios(p.ai_model).map((r) => <option key={r}>{r}</option>)}
              </select></span></div>
            {tab === "text-to-image" && <div className="field"><span className="flabel">Pose</span><span className="fval">
              <select value={p.pose_mode ?? ""} onChange={(e) => setP({ ...p, pose_mode: (e.target.value || undefined) as "t-pose" })}><option value="">None</option><option value="a-pose">A-pose</option><option value="t-pose">T-pose</option></select></span></div>}
            <div className="field"><span className="flabel">Background</span><span className="fval">
              <label className="check"><input type="checkbox" checked={!!p.remove_background} onChange={(e) => setP({ ...p, remove_background: e.target.checked || undefined })} />Transparent (removes the background)</label></span></div>
          </>}
        </div>

        {[...problems, ...(name && !nameOk ? ["That name has characters a file can't have."] : [])].map((m) => <p key={m} className="warn small">{m}</p>)}
        {error && <p className="error small">{error}</p>}
        <div className="row end">
          {cost > 0 && <span className="credits">~{cost} credits</span>}
          <button className="primary" disabled={!name || !nameOk || problems.length > 0} onClick={go}>{tab === "text-to-3d" ? "Add the card" : "Make it…"}</button>
        </div>
      </aside>
    </div>
  );
}
