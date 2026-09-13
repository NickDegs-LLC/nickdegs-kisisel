// sayfa.js (OTOMATİK ÜRETİLDİ) için tip bildirimi — üretici: cf/tools/motor3d/uret.mjs
export type SayfaCikti = {
  HTML: string
  IN: Record<string, unknown>
  smPath: { lon: number; lat: number }[]
  pts: Record<string, any>[]
  frames: number; fps: number; zoom: number; pitch: number
  title: { date: string; totkm: string }
  W: number; H: number; OW: number; OH: number
}
export declare function sayfaUret(
  IN: Record<string, unknown>, MLJS: string, MLCSS: string,
  HARITA_TABAN: string, DEM_TABAN: string,
): SayfaCikti
