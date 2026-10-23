// codemode.ts asks for RpcTarget where the runtime has it; this is all it needs of the module.
declare module "cloudflare:workers" {
  export class RpcTarget {}
}
