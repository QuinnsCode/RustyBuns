// An object to GLB bytes, for scripts that write a model file under Bun. three's GLTFExporter reads its binary
// chunk with the browser's FileReader, which Bun doesn't have, so a small one stands in while it runs.
import type * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
}

export async function toGlb(o: THREE.Object3D): Promise<ArrayBuffer> {
  const g = globalThis as { FileReader?: unknown };
  const had = g.FileReader;
  g.FileReader ??= BlobReader;
  try {
    const out = await new GLTFExporter().parseAsync(o, { binary: true });
    if (!(out instanceof ArrayBuffer)) throw new Error("GLTFExporter gave JSON, not a GLB");
    return out;
  } finally {
    if (!had) delete g.FileReader;
  }
}
