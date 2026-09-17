// Talking to SuperSplat, which runs unmodified in a same-origin iframe.
//
// Opening: SuperSplat reads ?load=<url>&filename=<name> at startup and
// decodes each value one extra time, so they're encoded twice here.
// Live actions (add to scene, unsaved-changes check): SuperSplat sets
// window.scene, whose `events` bus is how its own UI calls "import" and
// "scene.dirty". It's not a documented API, so the commit is pinned
// (scripts/build-editor.ts) and tests/editor-hook.test.ts checks it's still there.
import { fileUrl, type Scene } from "./api.ts";

interface EditorEvents { invoke(name: string, ...args: unknown[]): unknown }

export function editorSrc(scene?: Scene | null): string {
  if (!scene) return "/editor/";
  const twice = (s: string) => encodeURIComponent(encodeURIComponent(s));
  return `/editor/?load=${twice(fileUrl(scene.path))}&filename=${twice(scene.name)}`;
}

export function editorEvents(frame: HTMLIFrameElement | null): EditorEvents | null {
  try {
    const ev = (frame?.contentWindow as any)?.scene?.events;
    return ev && typeof ev.invoke === "function" ? ev : null;
  } catch {
    return null;   // not loaded yet, or not same-origin
  }
}

export async function waitForEditor(frame: HTMLIFrameElement | null, timeoutMs = 30_000): Promise<EditorEvents> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ev = editorEvents(frame);
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The editor didn't finish starting. It needs WebGPU: use a recent Chrome, Edge or Safari.");
}

export async function addToScene(frame: HTMLIFrameElement | null, scene: Scene) {
  const ev = await waitForEditor(frame);
  await ev.invoke("import", [{ filename: scene.name, url: fileUrl(scene.path) }]);
}

/** True when the editor has edits that switching scenes would throw away. */
export function hasUnsavedChanges(frame: HTMLIFrameElement | null): boolean {
  try { return Boolean(editorEvents(frame)?.invoke("scene.dirty")); } catch { return false; }
}
