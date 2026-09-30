import type { ChromeActions, ChromeView } from "../contract"
import { CARD } from "../../device-frame.js"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import "../tokens.css"
import "./canvas.css"

/**
 * Credit-card calibration (decision 7): the outline is drawn at the card's
 * size in the current px per mm, and the slider moves it until it matches a
 * real card held to the screen. Keyboard arrows step the slider by 0.01.
 */
export function Calibration({ view, actions }: { readonly view: ChromeView; readonly actions: ChromeActions }) {
  if (view.calibration._tag === "Closed") return null
  const { pxPerMm, calibrated } = view.calibration
  return <section className="dr-calibrate" data-cal={CAL.calibration} aria-label="Calibrate">
    <div className="dr-calibrate__card" style={{ width: CARD.widthMm * pxPerMm, height: CARD.heightMm * pxPerMm, borderRadius: 3.18 * pxPerMm }}>
      <b>Match a credit card</b><span>{CARD.widthMm} × {CARD.heightMm} mm</span>
    </div>
    <div className="dr-calibrate__panel">
      <p>Set the browser zoom to 100%. Hold a credit card against the screen, and move the slider until the outline matches the card.</p>
      <label className="dr-calibrate__scale"><span>Scale</span>
        <input data-cal={CAL.calibrationScale} type="range" min="2" max="12" step="0.01" value={pxPerMm} onChange={event => actions.onPxPerMm(Number(event.currentTarget.value))} />
        <output>{pxPerMm.toFixed(2)} px/mm</output>
      </label>
      <p className="dr-calibrate__state">{Math.round(pxPerMm * 25.4)} px per inch · {calibrated ? "calibrated on this monitor" : "assumed, no calibration yet"}</p>
      <div className="dr-calibrate__actions">
        <Button hook={CAL.calibrationReset} onClick={actions.onResetCalibration}>Reset</Button>
        <Button hook={CAL.calibrationClose} tone="primary" onClick={actions.onCalibrationClose}>Done</Button>
      </div>
    </div>
  </section>
}
