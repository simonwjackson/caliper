import type { ChromeActions, ChromeView } from "../contract"
import type { FrameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import "../tokens.css"
import "./canvas.css"

/**
 * One line under the frames in the dimmest ink: the devices as the switch,
 * the width, and whether the frames are true size (decisions 6 and 8). A
 * scaled frame says so in the warn colour. Before calibration, true size is
 * only an assumption, and the line offers Calibrate.
 */
export function Caption({ view, actions, geometry }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly geometry: FrameGeometry | null }) {
  const device = view.device
  const scaled = geometry?.fit._tag === "Scaled" ? geometry.fit.percent : null
  return <div className="dr-caption" data-cal={CAL.caption}>
    <span className="dr-caption__devices" role="group" aria-label="Device">
      {view.devices.map(item => <button key={item.id} type="button" className="dr-caption__device" data-cal={CAL.device} data-device={item.id}
        aria-pressed={item.id === device.id} onClick={() => actions.onDevice(item.id)}>{item.name}</button>)}
    </span>
    <span className="dr-caption__sep" aria-hidden="true">·</span>
    <span className="dr-caption__size" title={`${device.cssWidth} × ${device.cssHeight} CSS px. ${device.viewportNote}`}>
      {device.widthMm} mm<span className="dr-sr">, {device.cssWidth} by {device.cssHeight} CSS pixels</span>
    </span>
    <span className="dr-caption__sep" aria-hidden="true">·</span>
    {scaled !== null
      ? <span className="dr-caption__fit dr-caption__fit--scaled" role="status">Scaled to {scaled}%: the canvas is too small for true size</span>
      : view.calibrated
        ? <span className="dr-caption__fit">True size</span>
        : <span className="dr-caption__fit">True size at 96 dpi until <button type="button" className="dr-caption__calibrate" onClick={() => actions.onTool("calibrate")}>calibration</button></span>}
  </div>
}
