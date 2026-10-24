// codemode.ts asks for these where the runtime has them (the edge); this is all it needs of the module.
declare module "cloudflare:workers" {
  export class WorkerEntrypoint {}
  export const exports: Record<string, unknown>;
}
