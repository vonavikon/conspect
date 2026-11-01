// Declarations for binary assets inlined by esbuild as data: URLs (build.mjs,
// loader .woff2: dataurl). Without this, tsc --noEmit does not see the @fontsource/.../*.woff2 modules.
declare module "*.woff2" {
  const src: string;
  export default src;
}
declare module "*.woff" {
  const src: string;
  export default src;
}
