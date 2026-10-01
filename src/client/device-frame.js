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

/** Millimetres for `px` panel pixels at `ppi` pixels per inch. */
const mm = (/** @type {number} */ px, /** @type {number} */ ppi) => Math.round((px / ppi) * 254) / 10

/**
 * The devices a project gets when it sets no `devices` option: common phones,
 * a tablet, a laptop and a desktop monitor. The first one is the default
 * device. Physical sizes come from each maker's published panel resolution
 * and pixel density, or its active area. The CSS viewport is the whole screen
 * in CSS px, as Chrome DevTools' device mode gives it; a browser's own bars
 * make the real page shorter.
 *
 * @type {readonly Device[]}
 */
export const STANDARD_DEVICES = [
  {
    id: "iphone-16",
    name: "iPhone 16",
    widthMm: mm(1179, 460),
    heightMm: mm(2556, 460),
    cssWidth: 393,
    cssHeight: 852,
    viewportNote: "Apple tech specs: 2556 × 1179 px at 460 ppi. Device pixel ratio 3. Whole screen; Safari's bars take some of it.",
  },
  {
    id: "pixel-7",
    name: "Pixel 7",
    widthMm: mm(1080, 416),
    heightMm: mm(2400, 416),
    cssWidth: 412,
    cssHeight: 915,
    viewportNote: "Google Store specs: 1080 × 2400 px at 416 ppi. Device pixel ratio 2.625, as in Chrome DevTools. Whole screen; Chrome's bars take some of it.",
  },
  {
    id: "ipad-air-11",
    name: "iPad Air 11″",
    widthMm: mm(1640, 264),
    heightMm: mm(2360, 264),
    cssWidth: 820,
    cssHeight: 1180,
    viewportNote: "Apple tech specs (M2): 2360 × 1640 px at 264 ppi, held upright. Device pixel ratio 2. Whole screen; Safari's bars take some of it.",
  },
  {
    id: "macbook-air-13",
    name: "MacBook Air 13″",
    widthMm: mm(2560, 224),
    heightMm: mm(1664, 224),
    cssWidth: 1470,
    cssHeight: 956,
    viewportNote: "Apple tech specs (M2, M3): 2560 × 1664 px at 224 ppi. macOS's default scale looks like 1470 × 956. Whole screen; the browser window is smaller.",
  },
  {
    id: "monitor-24",
    name: "24″ monitor",
    widthMm: 527.04,
    heightMm: 296.46,
    cssWidth: 1920,
    cssHeight: 1080,
    viewportNote: "A 23.8″ 1920 × 1080 panel at scale 1. Active area from Dell's P2422H guide: 527.04 × 296.46 mm. Whole screen; the browser window is smaller.",
  },
]

/**
 * Devices a project can name by id in `caliper({ devices })`, beyond the
 * standard ones. Their CSS viewports are inferred, not measured.
 *
 * @type {readonly Device[]}
 */
export const HANDHELD_DEVICES = [
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

/** Every device a project can name by id. */
export const KNOWN_DEVICES = [...STANDARD_DEVICES, ...HANDHELD_DEVICES]

/**
 * @typedef {{ _tag: "Resolved", devices: readonly Device[] }
 *   | { _tag: "Invalid", reason: string }} DeviceList
 */

/**
 * Turn the `devices` option into the project's device list. No option gives
 * the standard devices. A string names a known device; an object declares a
 * device of the project's own. The first device is the default one.
 *
 * @param {unknown} option
 * @returns {DeviceList}
 */
export function resolveDevices(option) {
  if (option === undefined) return { _tag: "Resolved", devices: STANDARD_DEVICES }
  const known = KNOWN_DEVICES.map(device => device.id).join(", ")
  if (!Array.isArray(option) || option.length === 0) {
    return { _tag: "Invalid", reason: `caliper({ devices }) must be a list with at least one device. Name a known device (${known}) or declare one as { id, name, widthMm, heightMm, cssWidth, cssHeight }.` }
  }
  /** @type {Device[]} */
  const devices = []
  for (const entry of option) {
    const device = typeof entry === "string" ? KNOWN_DEVICES.find(candidate => candidate.id === entry) : declaredDevice(entry)
    if (device === undefined) {
      return { _tag: "Invalid", reason: typeof entry === "string"
        ? `caliper({ devices }) names "${entry}", which Caliper does not know. Known devices: ${known}.`
        : `caliper({ devices }) has a device that is not { id, name, widthMm, heightMm, cssWidth, cssHeight } with a text id and name and positive sizes: ${JSON.stringify(entry)}.` }
    }
    if (devices.some(other => other.id === device.id)) return { _tag: "Invalid", reason: `caliper({ devices }) has the device "${device.id}" twice.` }
    devices.push(device)
  }
  return { _tag: "Resolved", devices }
}

/**
 * @param {unknown} entry
 * @returns {Device | undefined}
 */
function declaredDevice(entry) {
  if (entry === null || typeof entry !== "object") return undefined
  const { id, name, widthMm, heightMm, cssWidth, cssHeight, viewportNote } = /** @type {Record<string, unknown>} */ (entry)
  const text = (/** @type {unknown} */ value) => typeof value === "string" && value.trim() !== ""
  const size = (/** @type {unknown} */ value) => typeof value === "number" && Number.isFinite(value) && value > 0
  if (!text(id) || !text(name) || !size(widthMm) || !size(heightMm) || !size(cssWidth) || !size(cssHeight)) return undefined
  if (viewportNote !== undefined && typeof viewportNote !== "string") return undefined
  return {
    id: /** @type {string} */ (id), name: /** @type {string} */ (name),
    widthMm: /** @type {number} */ (widthMm), heightMm: /** @type {number} */ (heightMm),
    cssWidth: /** @type {number} */ (cssWidth), cssHeight: /** @type {number} */ (cssHeight),
    viewportNote: viewportNote ?? "Declared in the project's vite.config.",
  }
}

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

/**
 * Lay out several frames of one device side by side, for example every state
 * of one part.
 *
 * Every frame has the same size, so a comparison between frames is fair. That
 * size is the true size when one frame fits in `room`, with its caption. When
 * one frame does not fit, all frames scale down together. Rows that do not fit
 * the height scroll: a frame never shrinks only because there are many.
 *
 * @param {Device} device
 * @param {number} pxPerMm chrome CSS px per millimetre on this monitor
 * @param {{ width: number, height: number }} room chrome CSS px available
 * @param {number} count how many frames
 * @param {{ gap: number, caption: number }} spacing chrome CSS px between two
 *   frames, and above each frame for its caption
 * @returns {{ frame: FrameGeometry, columns: number }}
 */
export function gridGeometry(device, pxPerMm, room, count, spacing) {
  const frame = frameGeometry(device, pxPerMm, { width: room.width, height: room.height - spacing.caption })
  const fit = frame.width > 0 ? Math.floor((room.width + spacing.gap) / (frame.width + spacing.gap)) : 1
  return { frame, columns: Math.max(1, Math.min(count, fit)) }
}
