// Add a step to finished cards: every parameter Meshy takes for it, priced before you confirm.
import { useEffect, useState } from "react";
import { scrimProps } from "./scrim.ts";
import { checkOp, estimateOp, OP_LABEL, OUT_FORMATS, texturedAfter, type AnimateParams, type OutFormat, type PostProcess } from "../engine/ops.ts";
import { RETEXTURE_DEFAULTS, type RetextureOptions } from "../engine/presets.ts";
import { api, type Card, type LibraryAction, type OpKind, type Preset } from "./api.ts";
import type { Row, SendAsk } from "./Confirm.tsx";

type UiKind = OpKind | "motion-animate";
const KINDS: { id: UiKind; label: string; about: string }[] = [
  { id: "retexture", label: "Texture", about: "Paint the model: styled from a text prompt, or an image (the card's texture image, else its concept image). 10 credits, 15 at 8k." },
  { id: "refine", label: "Texture (refine)", about: "Text to 3D's own texture step, on the preview. 10 credits, 15 at 8k." },
  { id: "remesh", label: "Remesh", about: "New topology and polycount. 5 credits." },
  { id: "resize", label: "Resize at Meshy", about: "Meshy sets the height or longest side (or guesses the real size). 002 then keeps Meshy's size. 1 credit. (Sizing in the card is free and local.)" },
  { id: "uv-unwrap", label: "UV unwrap", about: "New UVs for meshes up to 40,000 faces (remesh first if bigger). Comes back untextured. 5 credits." },
  { id: "convert", label: "Convert", about: "Other formats into 001, .blend included. 1 credit." },
  { id: "rig", label: "Rig", about: "A humanoid skeleton, plus walking and running clips. Needs a textured biped facing +Z, up to 300,000 faces. 5 credits." },
  { id: "animate", label: "Animate", about: "Library actions on the rigged character, merged into one file. 3 credits per action, up to 10." },
  { id: "motion-animate", label: "Animate from text", about: "Text to Motion makes a clip (10 credits prime / 3 swift), then it's applied to the rig (3 credits)." },
];
const CATEGORIES = ["", "WalkAndRun", "BodyMovements", "DailyActions", "Fighting", "Dancing"];

export function StepDialog({ cards, presets, initial, onClose, onAsk }: {
  cards: Card[]; presets: Preset[]; initial?: UiKind; onClose: () => void; onAsk: (a: SendAsk) => void;
}) {
  const [kind, setKind] = useState<UiKind>(initial ?? "remesh");
  // One state bag per kind, so switching back keeps what was typed.
  const [tex, setTex] = useState<{ style: "image" | "prompt"; prompt: string; options: RetextureOptions }>({ style: "image", prompt: "", options: {} });
  const [refine, setRefine] = useState<RetextureOptions>({});
  const [remesh, setRemesh] = useState<{ topology?: "triangle" | "quad"; target_polycount?: number; decimation_mode?: 1 | 2 | 3 | 4; target_formats: OutFormat[]; alpha_thumbnail?: boolean }>({ target_formats: [] });
  const [resize, setResize] = useState<{ mode: "height" | "longest" | "auto"; meters?: number; origin_at?: "bottom" | "center" }>({ mode: "height", meters: 1 });
  const [convert, setConvert] = useState<OutFormat[]>(["fbx"]);
  const [rigH, setRigH] = useState<number | undefined>(undefined);
  const [anim, setAnim] = useState<{ ids: number[]; post: PostProcess | null; label: string }>({ ids: [], post: null, label: "" });
  const [motion, setMotion] = useState<{ prompt: string; mode: "prime" | "swift"; duration: number }>({ prompt: "", mode: "prime", duration: 4 });
  const [lib, setLib] = useState<LibraryAction[] | null>(null);
  const [libQ, setLibQ] = useState({ search: "", category: "" });
  const [libErr, setLibErr] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "animate") return;
    const t = setTimeout(() => api.animations(libQ).then((l) => { setLib(l); setLibErr(null); }, (e) => setLibErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [kind, libQ.search, libQ.category]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  const animParams = (fromMotion: boolean): AnimateParams => ({ ...(fromMotion ? { fromMotion: true } : { action_ids: anim.ids }), ...(anim.post ? { post_process: anim.post } : {}), label: anim.label || undefined });
  const steps = (): { kind: OpKind; params: any }[] => {
    switch (kind) {
      case "retexture": return [{ kind, params: { style: tex.style, ...(tex.style === "prompt" ? { prompt: tex.prompt } : {}), options: tex.options } }];
      case "refine": return [{ kind, params: { options: refine } }];
      case "remesh": return [{ kind, params: remesh }];
      case "resize": return [{ kind, params: resize }];
      case "uv-unwrap": return [{ kind, params: {} }];
      case "convert": return [{ kind, params: { target_formats: convert } }];
      case "rig": return [{ kind, params: rigH ? { height_meters: rigH } : {} }];
      case "animate": return [{ kind, params: animParams(false) }];
      case "motion-animate": return [{ kind: "motion", params: motion }, { kind: "animate", params: { ...animParams(true), label: anim.label || motion.prompt.slice(0, 40) } }];
    }
    return [];
  };

  // Which cards can take it (the host checks again and skips the rest).
  const fits = (c: Card) => {
    if (c.state !== "done") return false;
    if (kind === "refine") return c.source === "text" && c.modelTask?.kind === "text-to-3d";
    if (kind === "animate" || kind === "motion-animate") return !!c.rigTaskId || (c.ops ?? []).some((o) => o.kind === "rig" && o.state !== "failed");
    // Meshy rigs textured humanoids only: textured already, or a texture step queued before it.
    if (kind === "rig") return texturedAfter(c);
    return true;
  };
  const ok = cards.filter(fits);
  const preset = (c: Card) => presets.find((p) => p.prefix === c.prefix);
  const priceOn = (c: Card) => steps().reduce((n, s) => n + estimateOp(s.kind, s.kind === "retexture" ? { ...s.params, options: { ...preset(c)?.retexture, ...s.params.options } } : s.params), 0);
  const problems = [...new Set(steps().flatMap((s) => checkOp(s.kind, s.params)))];
  const rows: Row[] = [];
  for (const c of ok) {
    const each = priceOn(c);
    const label = KINDS.find((k) => k.id === kind)!.label;
    const r = rows.find((x) => x.each === each);
    if (r) r.n++; else rows.push({ label, n: 1, each });
  }

  const go = () => {
    const [first, ...then] = steps();
    onAsk({
      kind: "spend", title: `${KINDS.find((k) => k.id === kind)!.label} on ${ok.length} card${ok.length === 1 ? "" : "s"}?`, rows,
      note: cards.length > ok.length ? `${cards.length - ok.length} selected card${cards.length - ok.length === 1 ? " doesn't" : "s don't"} fit this step and ${cards.length - ok.length === 1 ? "is" : "are"} left out.` : undefined,
      run: (credits) => api.op(ok.map((c) => c.key), first!.kind, first!.params, credits, then),
    });
  };

  const fmtBoxes = (list: OutFormat[], set: (l: OutFormat[]) => void, skip: OutFormat[] = []) => (
    <span className="row">
      {OUT_FORMATS.filter((f) => !skip.includes(f)).map((f) => (
        <label key={f} className="check"><input type="checkbox" checked={list.includes(f)} onChange={(e) => set(e.target.checked ? [...list, f] : list.filter((x) => x !== f))} />.{f}</label>
      ))}
    </span>
  );
  const retexFields = (o: RetextureOptions, set: (o: RetextureOptions) => void) => (
    <>
      <F label="AI model"><select value={o.ai_model ?? ""} onChange={(e) => set({ ...o, ai_model: (e.target.value || undefined) as RetextureOptions["ai_model"] })}>
        <option value="">Preset / Meshy default</option>{["latest", "meshy-7", "meshy-6", "meshy-6-lite"].map((m) => <option key={m}>{m}</option>)}</select></F>
      <F label="Texture resolution" hint="10 credits at 2k or 4k, 15 at 8k. meshy-6-lite: 2k."><select value={o.texture_resolution ?? ""} onChange={(e) => set({ ...o, texture_resolution: (e.target.value || undefined) as RetextureOptions["texture_resolution"] })}>
        <option value="">Preset / {RETEXTURE_DEFAULTS.texture_resolution}</option>{["2k", "4k", "8k"].map((m) => <option key={m}>{m}</option>)}</select></F>
      <F label="PBR maps"><Tri value={o.enable_pbr} onChange={(v) => set({ ...o, enable_pbr: v })} /></F>
      {kind === "retexture" && <F label="Keep the model's UVs" hint="Off lets Meshy unwrap new UVs."><Tri value={o.enable_original_uv} onChange={(v) => set({ ...o, enable_original_uv: v })} /></F>}
      <F label="Remove lighting" hint="meshy-6 only."><Tri value={o.remove_lighting} onChange={(v) => set({ ...o, remove_lighting: v })} /></F>
    </>
  );

  return (
    <div className="scrim" {...scrimProps(onClose)}>
      <aside className="drawer plate" role="dialog" aria-label="Add a step">
        <header className="row"><h2>Add a step</h2><span className="grow" /><button className="ghost small" onClick={onClose}>Close</button></header>
        <p className="muted small">On {cards.length === 1 ? cards[0]!.outName : `${cards.length} cards`}. Steps run in order after the card's others, each on the result of the one before.</p>
        <div className="kinds">
          {KINDS.map((k) => <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </div>
        <p className="small">{KINDS.find((k) => k.id === kind)!.about}</p>

        <div className="form">
          {kind === "retexture" && <>
            <F label="Style from"><select value={tex.style} onChange={(e) => setTex({ ...tex, style: e.target.value as "image" | "prompt" })}><option value="image">An image</option><option value="prompt">A text prompt</option></select></F>
            {tex.style === "prompt" && <F label="Texture prompt" hint="Up to 800 characters."><textarea rows={3} maxLength={800} value={tex.prompt} onChange={(e) => setTex({ ...tex, prompt: e.target.value })} /></F>}
            {retexFields(tex.options, (o) => setTex({ ...tex, options: o }))}
          </>}
          {kind === "refine" && retexFields(refine, setRefine)}
          {kind === "remesh" && <>
            <F label="Topology"><select value={remesh.topology ?? ""} onChange={(e) => setRemesh({ ...remesh, topology: (e.target.value || undefined) as "quad" })}><option value="">Meshy default (triangle)</option><option value="triangle">Triangle (decimated)</option><option value="quad">Quad-dominant</option></select></F>
            <F label="Target polycount" hint="100 to 300,000 (default 30,000)."><input className="num" type="number" min={100} max={300000} step={500} value={remesh.target_polycount ?? ""} placeholder="30000" onChange={(e) => setRemesh({ ...remesh, target_polycount: e.target.value ? Number(e.target.value) : undefined })} /></F>
            <F label="Adaptive decimation" hint="Overrides the polycount."><select value={remesh.decimation_mode ?? ""} onChange={(e) => setRemesh({ ...remesh, decimation_mode: e.target.value ? Number(e.target.value) as 1 : undefined })}><option value="">Off</option><option value="1">1 ultra</option><option value="2">2 high</option><option value="3">3 medium</option><option value="4">4 low</option></select></F>
            <F label="Also make" hint=".glb is always made.">{fmtBoxes(remesh.target_formats, (l) => setRemesh({ ...remesh, target_formats: l }), ["glb"])}</F>
            <F label="Transparent thumbnail"><Tri value={remesh.alpha_thumbnail} onChange={(v) => setRemesh({ ...remesh, alpha_thumbnail: v })} /></F>
          </>}
          {kind === "resize" && <>
            <F label="Size by"><select value={resize.mode} onChange={(e) => setResize({ ...resize, mode: e.target.value as "height" })}><option value="height">Height</option><option value="longest">Longest side</option><option value="auto">Meshy's guess (auto_size)</option></select></F>
            {resize.mode !== "auto" && <F label="Meters"><input className="num" type="number" min={0.01} step={0.1} value={resize.meters ?? ""} onChange={(e) => setResize({ ...resize, meters: Number(e.target.value) })} /></F>}
            <F label="Origin"><select value={resize.origin_at ?? ""} onChange={(e) => setResize({ ...resize, origin_at: (e.target.value || undefined) as "bottom" })}><option value="">Meshy default (bottom)</option><option value="bottom">Bottom</option><option value="center">Center</option></select></F>
          </>}
          {kind === "convert" && <F label="Formats">{fmtBoxes(convert, setConvert)}</F>}
          {kind === "rig" && <F label="Character height" hint="Meters. Blank uses the card's height (or Meshy's 1.7 m)."><input className="num" type="number" min={0.1} step={0.1} value={rigH ?? ""} placeholder="card height" onChange={(e) => setRigH(e.target.value ? Number(e.target.value) : undefined)} /></F>}
          {kind === "motion-animate" && <>
            <F label="Motion" hint="Up to 400 characters, e.g. 'a slow victory dance'."><textarea rows={2} maxLength={400} value={motion.prompt} onChange={(e) => setMotion({ ...motion, prompt: e.target.value })} /></F>
            <F label="Quality"><select value={motion.mode} onChange={(e) => setMotion({ ...motion, mode: e.target.value as "prime" })}><option value="prime">Prime: best, FBX (10 credits)</option><option value="swift">Swift: faster, BVH (3 credits)</option></select></F>
            <F label="Duration" hint="2 to 10 seconds."><input className="num" type="number" min={2} max={10} step={0.5} value={motion.duration} onChange={(e) => setMotion({ ...motion, duration: Number(e.target.value) })} /> s</F>
          </>}
          {(kind === "animate" || kind === "motion-animate") && <>
            {kind === "animate" && <>
              <F label="Actions" hint={`${anim.ids.length} of 10 picked, played in this order.`}>
                <span className="row">
                  {anim.ids.map((id) => {
                    const a = lib?.find((x) => x.action_id === id);
                    return <button key={id} className="ghost small" onClick={() => setAnim({ ...anim, ids: anim.ids.filter((x) => x !== id) })} title="Remove">{a?.name ?? `#${id}`} ✕</button>;
                  })}
                </span>
              </F>
              <div className="row">
                <input className="grow" placeholder="Search the library" value={libQ.search} onChange={(e) => setLibQ({ ...libQ, search: e.target.value })} />
                <select value={libQ.category} onChange={(e) => setLibQ({ ...libQ, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c || "All categories"}</option>)}</select>
              </div>
              {libErr && <p className="error small">{libErr}</p>}
              <ul className="library">
                {(lib ?? []).slice(0, 60).map((a) => {
                  const on = anim.ids.includes(a.action_id);
                  return (
                    <li key={a.action_id}>
                      <button className={on ? "on" : ""} disabled={!on && anim.ids.length >= 10}
                        onClick={() => setAnim({ ...anim, ids: on ? anim.ids.filter((x) => x !== a.action_id) : [...anim.ids, a.action_id] })}>
                        {a.preview_url && <img src={a.preview_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />}
                        <span>{a.name}</span><span className="muted small">{a.category}</span>
                      </button>
                    </li>
                  );
                })}
                {lib && !lib.length && <li className="muted small">No actions match.</li>}
              </ul>
            </>}
            <F label="Post-process">
              <select value={anim.post?.operation_type ?? ""} onChange={(e) => setAnim({ ...anim, post: e.target.value ? (e.target.value === "change_fps" ? { operation_type: "change_fps", fps: 30 } : { operation_type: e.target.value as "fbx2usdz" }) : null })}>
                <option value="">None</option><option value="change_fps">Change FPS</option><option value="fbx2usdz">Also make .usdz</option><option value="extract_armature">Extract the armature</option>
              </select>
              {anim.post?.operation_type === "change_fps" && <select value={anim.post.fps ?? 30} onChange={(e) => setAnim({ ...anim, post: { operation_type: "change_fps", fps: Number(e.target.value) as 30 } })}>{[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select>}
            </F>
            <F label="Name" hint="Used in the file name: <model>.anim-<name>.glb"><input value={anim.label} placeholder={kind === "animate" ? "e.g. combat set" : "from the prompt"} onChange={(e) => setAnim({ ...anim, label: e.target.value })} /></F>
          </>}
        </div>

        {problems.map((m) => <p key={m} className="warn small">{m}</p>)}
        {ok.length < cards.length && <p className="muted small">{cards.length - ok.length} of these can't take this step yet{kind.includes("anim") ? " (rig them first)" : kind === "refine" ? " (refine is for Text to 3D cards)" : kind === "rig" ? " (Meshy rigs textured models: texture them first, or add a texture step before)" : " (they need a finished model)"}.</p>}
        <div className="row end">
          <span className="credits">~{rows.reduce((n, r) => n + r.n * r.each, 0)} credits</span>
          <button className="primary" disabled={!ok.length || problems.length > 0} onClick={go}>Add {OP_LABEL[(kind === "motion-animate" ? "animate" : kind) as OpKind].toLowerCase()} step…</button>
        </div>
      </aside>
    </div>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field"><span className="flabel">{label}</span><span className="fval">{children}{hint && <span className="muted small hint">{hint}</span>}</span></div>;
}
function Tri({ value, onChange }: { value?: boolean; onChange: (v: boolean | undefined) => void }) {
  return (
    <select value={value === undefined ? "" : value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "on")}>
      <option value="">Default</option><option value="on">On</option><option value="off">Off</option>
    </select>
  );
}
