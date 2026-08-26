// Декларации для бинарных ассетов, инлайнируемых esbuild как data: URL (build.mjs,
// loader .woff2: dataurl). Без этого tsc --noEmit не видит модулей @fontsource/.../*.woff2.
declare module "*.woff2" {
  const src: string;
  export default src;
}
declare module "*.woff" {
  const src: string;
  export default src;
}
