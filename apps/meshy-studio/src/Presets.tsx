// The preset editor: every Image to 3D and Retexture option, with Meshy's rules and prices
// checked as you go. Saves to the workspace's meshy-presets.json.
import { useEffect, useState } from "react";
import { scrimProps } from "./scrim.ts";
import { checkPreset, estimateCredits, estimateRetexture, FORMATS, RETEXTURE_DEFAULTS, type Format, type MeshyOptions, type RetextureOptions } from "../engine/presets.ts";
import { api, type Preset, type Summary } from "./api.ts";
import { OptionFields } from "./OptionFields.tsx";

type Opt = MeshyOptions;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function PresetsPanel({ sum, onClose, onSaved }: { sum: Summary; onClose: () => void; onSaved: (s: Summary) => void }) {
  const [list, setList] = useState<Preset[]>(() => clone(sum.presets));
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(list) !== JSON.stringify(sum.presets);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  const p = list[Math.min(at, list.length - 1)]!;
  const update = (fn: (p: Preset) => void) => { const next = clone(list); fn(next[at]!); setList(next); setSaved(false); };
  const o = (k: keyof Opt, v: unknown) => update((x) => { if (v === undefined || v === "") delete x.options[k]; else (x.options as any)[k] = v; });
  const r = (k: keyof RetextureOptions, v: unknown) => update((x) => {
    x.retexture ??= {};
    if (v === undefined || v === "") delete x.retexture[k]; else (x.retexture as any)[k] = v;
  });
  const save = () => api.savePresets(list).then((s) => { onSaved(s); setError(null); setSaved(true); }, (e) => setError(e.message));
  const add = () => {
    const n = clone(p);
    n.prefix = `new${list.length}_`;
    n.label = `${p.label} copy`;
    setList([...list, n]);
    setAt(list.length);
  };
  const remove = () => { setList(list.filter((_, i) => i !== at)); setAt(0); };

  const issues = checkPreset(p);
  const t2 = p.options.model_type === "smart-topology" || p.options.ai_model === "meshy-t2";
  const m71 = !t2 && (!p.options.ai_model || p.options.ai_model === "latest" || p.options.ai_model === "meshy-7.1");
  const sizeKind = "height" in p.size ? "height" : "longest" in p.size ? "longest" : "auto";
  const meters = "height" in p.size ? p.size.height : "longest" in p.size ? p.size.longest : 1;
  const rt = { ...RETEXTURE_DEFAULTS, ...p.retexture };

  return (
    <div className="scrim" {...scrimProps(onClose)}>
      <aside className="drawer wide plate" role="dialog" aria-label="Presets">
        <header className="row">
          <h2>Presets</h2>
          <span className="grow" />
          {error && <span className="error small" role="alert">{error}</span>}
          {saved && !dirty && <span className="ok small">Saved to meshy-presets.json</span>}
          <button className="primary small" disabled={!dirty} onClick={save}>Save</button>
          <button className="ghost small" onClick={onClose}>Close</button>
        </header>

        <div className="presets">
          <nav aria-label="Presets">
            {list.map((x, i) => (
              <button key={i} className={`folder ${i === at ? "active" : ""}`} onClick={() => setAt(i)}>
                <span>{x.label}</span><code className="count">{x.prefix || "(none)"}</code>
              </button>
            ))}
            <button className="ghost small" onClick={add}>Copy as new</button>
            {p.prefix !== "" && <button className="ghost small" onClick={remove}>Delete {p.label}</button>}
          </nav>

          <div className="form">
            <div className="prices">
              <span>Textured <strong className="credits">~{estimateCredits(p.options)}</strong></span>
              <span>Draft <strong className="credits">~{estimateCredits(p.options, { draft: true })}</strong></span>
              <span>Texture later <strong className="credits">~{estimateRetexture(p.retexture)}</strong></span>
              <span className="muted">credits per image</span>
            </div>
            {issues.map((m) => <p key={m} className="warn small">{m}</p>)}

            <Group title="Label">
              <Field label="Name"><input value={p.label} onChange={(e) => update((x) => { x.label = e.target.value; })} /></Field>
              <Field label="Filename prefix" hint={p.prefix === "" ? "The Default preset: any image with no known prefix." : `Images named ${p.prefix}… use this.`}>
                <input value={p.prefix} disabled={p.prefix === "" && list.filter((x) => x.prefix === "").length === 1}
                  onChange={(e) => update((x) => { x.prefix = e.target.value; })} />
              </Field>
              <Field label="Size">
                <select value={sizeKind} onChange={(e) => update((x) => {
                  x.size = e.target.value === "auto" ? { auto: true } : e.target.value === "height" ? { height: meters } : { longest: meters };
                })}>
                  <option value="height">Height</option><option value="longest">Longest side</option><option value="auto">Meshy's guess (auto_size)</option>
                </select>
                {sizeKind !== "auto" && <><input className="num" type="number" min={0.01} step={0.1} value={meters}
                  onChange={(e) => update((x) => { x.size = sizeKind === "height" ? { height: Number(e.target.value) } : { longest: Number(e.target.value) }; })} /> m</>}
              </Field>
              <Field label="Origin" hint={sizeKind === "auto" ? "Sent to Meshy as origin_at." : "Set locally after download."}>
                <Pick value={p.origin} options={["bottom", "center"]} onChange={(v) => update((x) => { x.origin = v as Preset["origin"]; })} />
              </Field>
            </Group>

            <OptionFields source="image" value={p.options} onSet={(patch) => update((x) => {
              for (const [k, v] of Object.entries(patch)) {
                if (v === undefined || v === null || v === "") delete (x.options as any)[k]; else (x.options as any)[k] = v;
              }
            })} />

            <Group title="Files">
              <Field label="Also download" hint=".glb is always made (002 is built from it). Others land in 001, with texture maps beside them.">
                <span className="row">
                  {FORMATS.filter((f) => f !== "glb").map((f) => (
                    <label key={f} className="check"><input type="checkbox" checked={!!p.formats?.includes(f)} onChange={(e) => update((x) => {
                      const set = new Set<Format>(x.formats ?? []);
                      if (e.target.checked) set.add(f); else set.delete(f);
                      x.formats = set.size ? FORMATS.filter((g) => set.has(g)) : undefined;
                    })} />.{f}</label>
                  ))}
                </span>
              </Field>
            </Group>

            <Group title="Texture later (Retexture on drafts)">
              <Field label="AI model"><Pick value={p.retexture?.ai_model} def options={["latest", "meshy-7", "meshy-6", "meshy-6-lite"]} onChange={(v) => r("ai_model", v)} /></Field>
              <Field label="Keep the model's UVs" hint="Meshy's own models have good UVs."><Bool value={rt.enable_original_uv} onChange={(v) => r("enable_original_uv", v)} /></Field>
              <Field label="PBR maps"><Bool value={p.retexture?.enable_pbr} onChange={(v) => r("enable_pbr", v)} /></Field>
              <Field label="Texture resolution" hint="10 credits at 2k or 4k, 15 at 8k."><Pick value={p.retexture?.texture_resolution} def options={["2k", "4k", "8k"]} onChange={(v) => r("texture_resolution", v)} /></Field>
              <Field label="Remove lighting" hint="meshy-6 only."><Bool value={p.retexture?.remove_lighting} onChange={(v) => r("remove_lighting", v)} /></Field>
            </Group>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="group"><h3>{title}</h3>{children}</section>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="flabel">{label}</span>
      <span className="fval">{children}{hint && <span className="muted small hint">{hint}</span>}</span>
    </div>
  );
}
/** A Meshy setting left unset uses Meshy's own default. */
function Pick({ value, options, def, disabled, labels, onChange }: { value?: string; options: string[]; def?: boolean; disabled?: boolean; labels?: Record<string, string>; onChange: (v: string | undefined) => void }) {
  return (
    <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
      {def && <option value="">Meshy default</option>}
      {options.map((v) => <option key={v} value={v}>{labels?.[v] ?? v}</option>)}
    </select>
  );
}
function Bool({ value, onChange }: { value?: boolean; onChange: (v: boolean | undefined) => void }) {
  return (
    <select value={value === undefined ? "" : value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "on")}>
      <option value="">Meshy default</option><option value="on">On</option><option value="off">Off</option>
    </select>
  );
}
