// Workers AI off the edge: there's no model here, so env.AI is there (an app that checks for it
// still loads) and each call fails with an error that says why, instead of
// "Cannot read properties of undefined".

export class LocalAi {
  constructor(readonly binding = "AI") {}
  private no(what: string): never {
    throw new Error(`Workers AI (${this.binding}): ${what} isn't available on the desktop; it runs only on Cloudflare`);
  }
  async run(model: string, _inputs?: unknown, _opts?: unknown): Promise<never> { this.no(`run("${model}")`); }
  async models(): Promise<never> { this.no("models()"); }
  gateway(id: string): never { this.no(`gateway("${id}")`); }
  autorag(id: string): never { this.no(`autorag("${id}")`); }
  toMarkdown(): never { this.no("toMarkdown()"); }
}

export const ai = (binding?: string) => new LocalAi(binding);
