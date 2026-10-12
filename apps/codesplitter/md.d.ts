// Markdown imported as text (`with { type: "text" }`), which Bun inlines when it bundles cli.js.
declare module "*.md" {
  const text: string;
  export default text;
}
