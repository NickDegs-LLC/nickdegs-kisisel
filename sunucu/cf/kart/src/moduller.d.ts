// wrangler [[rules]] ile paketlenen ikili modüller (kart/wrangler.toml):
//   CompiledWasm → WebAssembly.Module · Data → ArrayBuffer
declare module '*.wasm' {
  const m: WebAssembly.Module
  export default m
}
declare module '*.ttf' {
  const d: ArrayBuffer
  export default d
}
