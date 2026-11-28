// The host's forms (event-host.tsx), for a browser with script: times in the host's own zone, sent as instants, and a photo
// shrunk until the server will keep it (event-host.ts PICTURE_MAX). Without this the clocks are UTC and a big photo is refused.
const MAX = 500_000, SIDE = 1600;

const two = (n: number) => String(n).padStart(2, "0");
/** What a datetime-local input shows for an instant, on this machine's clock. */
const clock = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;

async function shrink(input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file || file.size <= MAX) return;
  const img = await createImageBitmap(file), k = Math.min(1, SIDE / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.5, 0.3]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", q));
    if (!blob || blob.size > MAX) continue;
    const box = new DataTransfer();
    box.items.add(new File([blob], "picture.jpg", { type: "image/jpeg" }));
    input.files = box.files;
    return;
  }
}

export function mountEventForms(doc: Document) {
  const times = [...doc.querySelectorAll<HTMLInputElement>('input[type="datetime-local"][data-at]')];
  for (const t of times) if (t.dataset.at) t.value = clock(new Date(Number(t.dataset.at)));
  for (const z of doc.querySelectorAll("[data-zone]")) z.textContent = "(your time)";
  for (const form of new Set(times.map((t) => t.form))) form?.addEventListener("submit", () => {
    for (const t of times.filter((x) => x.form === form)) {
      const at = t.closest("p")?.querySelector<HTMLInputElement>(`input[name="${t.name}_at"]`);
      if (at) at.value = t.value ? String(new Date(t.value).getTime()) : "";
    }
  });
  for (const input of doc.querySelectorAll<HTMLInputElement>("input[data-shrink]")) {
    const send = input.form?.querySelector("button");
    input.addEventListener("change", () => {
      if (send) send.disabled = true;
      void shrink(input).catch(() => null).finally(() => { if (send) send.disabled = false; });
    });
  }
}
