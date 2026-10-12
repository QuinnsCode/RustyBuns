// Layout: policy per path: how live edits go, the merge rule, who settles what is left; defaults under the repo's `.gitattributes`
/**
 * Policy per path (#938): how live edits go, how a merge settles a file, and
 * who gets what the merge can't settle. Defaults cover most files; a repo
 * overrides its hot spots in `.gitattributes`, as git's merge drivers do:
 *
 *   src/features.json  codesplitter-live=line codesplitter-leftover=ai
 *   CHANGELOG.md       merge=union
 *
 * `codesplitter-merge` takes a merge rule by name; git's own `merge=union` is
 * honoured, and `merge=binary` or `-merge` keeps one side's file whole.
 */
import { kindOf, type Kind } from "./lines.ts";

/** Live edits: anyone edits any line, wait in line for a claim first, or nobody edits it live (it's regenerated). */
export type Live = "free" | "line" | "locked";
/** A merge rule: one of the file kinds lines.ts merges by, or `union`, which keeps both sides of what they both rewrote. */
export type Rule = Kind | "union";
/** Who settles what the merge leaves: a checked AI and then a person, a person, or CI regenerating the file. */
export type Leftover = "ai" | "person" | "ci";
export interface Policy { live: Live; merge: Rule; leftover: Leftover }

const LIVES: Live[] = ["free", "line", "locked"], RULES: Rule[] = ["lock", "keyed", "prose", "code", "union"], LEFTOVERS: Leftover[] = ["ai", "person", "ci"];

/** The defaults, by file kind. */
export const DEFAULTS: Record<Kind, Policy> = {
  lock: { live: "locked", merge: "lock", leftover: "ci" },
  keyed: { live: "free", merge: "keyed", leftover: "ai" },
  prose: { live: "free", merge: "prose", leftover: "ai" },
  code: { live: "free", merge: "code", leftover: "person" },
};

/** A `.gitattributes` pattern as a regex over a repo path: no slash matches the name at any depth, a slash anchors it at the top. */
function glob(pattern: string): RegExp {
  const p = pattern.replace(/^\//, "");
  const body = p.split(/(\*\*\/|\/\*\*|\*|\?)/).map((part) =>
    part === "**/" ? "(?:.*/)?" : part === "/**" ? "/.*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(pattern.includes("/") && !pattern.endsWith("/") ? `^${body}$` : `(^|/)${body}$`);
}

type Rule1 = { re: RegExp; set: Partial<Policy> };
/** The lines of a `.gitattributes` that set a policy, in order: a later line wins. */
export function parseAttributes(text: string): Rule1[] {
  const out: Rule1[] = [];
  for (const raw of text.split("\n")) {
    const [pattern, ...attrs] = raw.trim().split(/\s+/);
    if (!pattern || pattern.startsWith("#") || pattern.startsWith("!")) continue;
    const set: Partial<Policy> = {};
    for (const a of attrs) {
      const [k, v] = a.split("=", 2);
      if (k === "merge" && v === "union") set.merge = "union";
      else if ((k === "merge" && v === "binary") || a === "-merge") set.merge = "lock";
      else if (k === "codesplitter-merge" && RULES.includes(v as Rule)) set.merge = v as Rule;
      else if (k === "codesplitter-live" && LIVES.includes(v as Live)) set.live = v as Live;
      else if (k === "codesplitter-leftover" && LEFTOVERS.includes(v as Leftover)) set.leftover = v as Leftover;
    }
    if (Object.keys(set).length) out.push({ re: glob(pattern), set });
  }
  return out;
}

/** The policy for `path`: its kind's defaults, then every matching `.gitattributes` line over them. */
export function policyOf(path: string, attributes = ""): Policy {
  const p = { ...DEFAULTS[kindOf(path)] };
  for (const r of parseAttributes(attributes)) if (r.re.test(path)) Object.assign(p, r.set);
  return p;
}
