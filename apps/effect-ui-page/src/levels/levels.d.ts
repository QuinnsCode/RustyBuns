// Bun bundles a picture import as the file's address.
declare module "*.jpg" {
  const url: string;
  export default url;
}
