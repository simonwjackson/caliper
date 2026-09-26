// @ts-check

/**
 * Devices and the geometry of a device frame. Pure data and arithmetic, so
 * the chrome and the tests share one definition.
 *
 * A device has two sizes. The physical size (millimetres) decides how big the
 * frame is drawn on a calibrated monitor. The CSS viewport (CSS px) is what
 * the page inside believes: its `window.innerWidth`, its `vw`, its media
 * queries. The frame renders the page at the CSS viewport and scales it to
 * the physical width.
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   widthMm: number,
 *   heightMm: number,
 *   cssWidth: number,
 *   cssHeight: number,
 *   viewportNote: string,
 * }} Device
 *
 * @typedef {{ _tag: "TrueSize" } | { _tag: "Scaled", percent: number }} Fit
 *
 * @typedef {{
 *   width: number,
 *   height: number,
 *   scale: number,
 *   fit: Fit,
 * }} FrameGeometry
 *   `width` and `height` are the drawn size in the chrome's CSS px. `scale`
 *   maps one device CSS px to chrome CSS px.
 */

/** @type {readonly Device[]} */
export const DEVICES = [
  {
    id: "rg353m",
    name: "RG353M",
    widthMm: 72,
    heightMm: 52,
    cssWidth: 640,
    cssHeight: 480,
    viewportNote: "Inferred: 640 × 480 panel under Sway at scale 1 (below Sway's 1200 px HiDPI height).",
  },
  {
    id: "odin2portal",
    name: "ODIN 2 PORTAL",
    widthMm: 156,
    heightMm: 85,
    cssWidth: 1920,
    cssHeight: 1080,
    viewportNote: "Inferred: 1920 × 1080 panel under Sway at scale 1 (no scale set; 1080 px is below Sway's 1200 px HiDPI height).",
  },
]

/** ISO/IEC 7810 ID-1, the size of a credit card. */
export const CARD = { widthMm: 85.6, heightMm: 53.98 }

/** CSS defines 96 px per inch. Caliper assumes it until the monitor is calibrated. */
export const DEFAULT_PX_PER_MM = 96 / 25.4

/**
 * Size a device frame for a calibrated monitor.
 *
 * The frame is drawn at the device's physical width when it fits in `room`.
 * When it does not fit, it is drawn as large as fits, and `fit` says by how
 * much it is scaled down. The height follows the CSS viewport's aspect, so the
 * page is never stretched.
 *
 * @param {Device} device
 * @param {number} pxPerMm chrome CSS px per millimetre on this monitor
 * @param {{ width: number, height: number }} room chrome CSS px available
 * @returns {FrameGeometry}
 */
export function frameGeometry(device, pxPerMm, room) {
  const trueScale = (device.widthMm * pxPerMm) / device.cssWidth
  const fitScale = Math.min(room.width / device.cssWidth, room.height / device.cssHeight)
  const scale = Math.min(trueScale, Math.max(fitScale, 0))
  /** @type {Fit} */
  const fit = scale < trueScale
    ? { _tag: "Scaled", percent: Math.floor((scale / trueScale) * 100) }
    : { _tag: "TrueSize" }
  return {
    width: device.cssWidth * scale,
    height: device.cssHeight * scale,
    scale,
    fit,
  }
}
