// Every generation option, as form fields. Used by the preset editor (values are the preset's)
// and by a card (values are overrides on top of its preset: "Preset: …" keeps the preset's).
import { checkOptions, estimateCredits, MODEL_CHOICES, modelOf, modelPatch, modelsFor, type MeshyOptions, type ModelId, type Source } from "../engine/presets.ts";

type Key = keyof MeshyOptions;
interface Def {
  key: Key; label: string; group: string; hint?: string;
  kind: "pick" | "bool" | "number";
  values?: string[]; labels?: Record<string, string>; min?: number; max?: number; step?: number;
  /** Hidden when it can't apply. */
  when?: (o: MeshyOptions, s: Source) => boolean;
}

const t2 = (o: MeshyOptions) => modelOf(o) === "meshy-t2";
const low = (o: MeshyOptions) => modelOf(o) === "lowpoly";
const m71 = (o: MeshyOptions) => modelOf(o) === "meshy-7.1";

export const OPTION_DEFS: Def[] = [
  { key: "geometry_resolution", label: "Geometry resolution", group: "Model", kind: "pick", values: ["standard", "2k", "4k"], hint: "Ultra geometry, meshy-7.1 only: +5 credits for 2k or 4k (multi-image: 2k).", when: m71 },
  { key: "should_texture", label: "Texture", group: "Texture", kind: "bool", hint: "Off makes an untextured shape, the same as a draft.", when: (_, s) => s !== "text" },
  { key: "enable_pbr", label: "PBR maps", group: "Texture", kind: "bool", hint: "Metallic, roughness and normal maps." },
  { key: "texture_resolution", label: "Texture resolution", group: "Texture", kind: "pick", values: ["2k", "4k", "8k"], hint: "meshy-6-lite is 2k only. 8k costs +5." },
  { key: "should_remesh", label: "Remesh", group: "Mesh", kind: "bool", hint: "Meshy's default: off for Meshy 6 and 7, on for the others.", when: (o) => !t2(o) && !low(o) },
  { key: "topology", label: "Topology", group: "Mesh", kind: "pick", values: ["triangle", "quad"], when: (o, s) => !low(o) && !(t2(o) && s === "text") },
  { key: "target_polycount", label: "Target polycount", group: "Mesh", kind: "number", min: 100, max: 300000, step: 500, hint: "Smart topology: 100 to 15,000. Remesh: 100 to 300,000.", when: (o) => !low(o) },
  { key: "decimation_mode", label: "Adaptive decimation", group: "Mesh", kind: "pick", values: ["1", "2", "3", "4"], labels: { 1: "1 ultra", 2: "2 high", 3: "3 medium", 4: "4 low" }, hint: "Overrides the polycount.", when: (o) => !low(o) },
  { key: "save_pre_remeshed_model", label: "Keep pre-remesh model", group: "Mesh", kind: "bool", hint: "Also downloads the model from before remeshing.", when: (o, s) => !low(o) && s !== "text" },
  { key: "pose_mode", label: "Pose", group: "Pose and cleanup", kind: "pick", values: ["a-pose", "t-pose"], labels: { "a-pose": "A-pose", "t-pose": "T-pose" } },
  { key: "image_enhancement", label: "Image enhancement", group: "Pose and cleanup", kind: "bool", hint: "meshy-6 and meshy-7.1. Default on.", when: (o, s) => s !== "text" && (m71(o) || o.ai_model === "meshy-6") },
  { key: "remove_lighting", label: "Remove lighting", group: "Pose and cleanup", kind: "bool", hint: "meshy-6 (and 7.1 for multi-image). Default on.", when: (o, s) => o.ai_model === "meshy-6" || (s === "multi" && m71(o)) },
  { key: "alpha_thumbnail", label: "Transparent thumbnail", group: "Previews and safety", kind: "bool" },
  { key: "multi_view_thumbnails", label: "Four-view thumbnails", group: "Previews and safety", kind: "bool", hint: "Front, right, back, left. About 3 s longer.", when: (_, s) => s !== "text" },
  { key: "moderation", label: "Moderation", group: "Previews and safety", kind: "bool", hint: "Meshy screens the inputs for harmful content." },
];

const show = (v: unknown) => v === undefined ? "Meshy default" : typeof v === "boolean" ? (v ? "On" : "Off") : String(v);

/**
 * value: the preset's options (preset mode) or the card's overrides (card mode, with `base`).
 * onSet(key, v): v = a value, null = Meshy's default, undefined = back to the preset's (card) / unset (preset).
 */
export function OptionFields({ source, value, base, onSet, disabled }: {
  source: Source; value: Partial<Record<Key, unknown>>; base?: MeshyOptions;
  onSet: (patch: Partial<Record<Key, unknown>>) => void; disabled?: boolean;
}) {
  const card = !!base;
  const merged: MeshyOptions = card
    ? Object.fromEntries(Object.entries({ ...base, ...value }).filter(([, v]) => v !== null)) as MeshyOptions
    : value as MeshyOptions;
  const groups = [...new Set(OPTION_DEFS.map((d) => d.group))];
  const model = modelOf(merged);

  const setModel = (id: string) => {
    if (id === "inherit") return onSet({ model_type: undefined, ai_model: undefined });
    const patch = modelPatch(merged, id as ModelId);
    // In a preset, "Meshy default" is just leaving the key out.
    if (!card) for (const k of Object.keys(patch) as Key[]) if (patch[k] === null) patch[k] = undefined;
    onSet(patch);
  };

  return (
    <div className="options">
      <section className="group">
        <h3>Model</h3>
        <div className="field">
          <span className="flabel">Model</span>
          <span className="fval">
            <ModelPicker source={source} options={merged} value={card && value.model_type === undefined && value.ai_model === undefined ? "inherit" : model}
              inheritLabel={card ? `Preset: ${MODEL_CHOICES.find((m) => m.id === modelOf(base!))!.label}` : undefined} onChange={setModel} disabled={disabled} />
          </span>
        </div>
        {groupFields("Model")}
      </section>
      {groups.filter((g) => g !== "Model").map((g) => {
        const fields = groupFields(g);
        return fields.length ? <section key={g} className="group"><h3>{g}</h3>{fields}</section> : null;
      })}
    </div>
  );

  function groupFields(g: string) {
    return OPTION_DEFS.filter((d) => d.group === g && (!d.when || d.when(merged, source))).map((d) => {
      const overridden = card && d.key in value;
      const own = value[d.key];
      const current = card ? (overridden ? own : undefined) : own;
      const sel = card && !overridden ? "inherit" : current === null || current === undefined ? "" : String(current);
      const parse = (v: string): unknown => v === "inherit" ? undefined : v === "" ? (card ? null : undefined)
        : d.kind === "bool" ? v === "true" : d.key === "decimation_mode" ? Number(v) : v;
      return (
        <div className="field" key={d.key}>
          <span className="flabel">{d.label}{overridden && <span className="tag dim" title="Set on this card">card</span>}</span>
          <span className="fval">
            {d.kind === "number" ? (
              <>
                <input className="num" type="number" min={d.min} max={d.max} step={d.step} disabled={disabled}
                  value={overridden ? (own as number ?? "") : card ? "" : (own as number ?? "")}
                  placeholder={card ? `preset: ${show(base![d.key])}` : "Meshy default"}
                  onChange={(e) => onSet({ [d.key]: e.target.value === "" ? undefined : Number(e.target.value) })} />
                {overridden && <button className="ghost small" onClick={() => onSet({ [d.key]: undefined })}>Use preset</button>}
              </>
            ) : (
              <select value={sel} disabled={disabled} onChange={(e) => onSet({ [d.key]: parse(e.target.value) })}>
                {card && <option value="inherit">Preset: {show(base![d.key])}</option>}
                <option value="">Meshy default</option>
                {(d.kind === "bool" ? ["true", "false"] : d.values!).map((v) => (
                  <option key={v} value={v}>{d.kind === "bool" ? (v === "true" ? "On" : "Off") : d.labels?.[v] ?? v}</option>
                ))}
              </select>
            )}
            {d.hint && <span className="muted small hint">{d.hint}</span>}
          </span>
        </div>
      );
    });
  }
}

/** Every model this source can use, each with what it would cost with these options. */
export function ModelPicker({ source, options, value, onChange, inheritLabel, disabled, draft, extra }: {
  source: Source; options: MeshyOptions; value: ModelId | "inherit"; onChange: (id: string) => void;
  inheritLabel?: string; disabled?: boolean; draft?: boolean;
  /** Card texture prompt/image add 10 credits: pass them for exact prices. */
  extra?: { texturePrompt?: string; textureImage?: string };
}) {
  const ids: ModelId[] = modelsFor(source);
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Model">
      {inheritLabel && <option value="inherit">{inheritLabel}</option>}
      {ids.map((id) => {
        const c = MODEL_CHOICES.find((m) => m.id === id)!;
        const o = Object.fromEntries(Object.entries({ ...options, ...modelPatch(options, id) }).filter(([, v]) => v !== null)) as MeshyOptions;
        const full = estimateCredits(o, { ...extra, draft: false }, source);
        const dr = estimateCredits(o, { ...extra, draft: true }, source);
        const bad = checkOptions(o, source).some((m) => !m.includes("only appl") && !m.startsWith("Low poly is deprecated"));
        return <option key={id} value={id}>{c.label} · ~{draft ? dr : full} cr{draft ? " draft" : ` (draft ${dr})`}{bad ? " ⚠" : ""}</option>;
      })}
    </select>
  );
}
