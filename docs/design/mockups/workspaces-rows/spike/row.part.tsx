import { useEffect, useState } from "react"
import { PicoSurface } from "../PicoSurface"
import { createFixtureHost, fixtureModel } from "../fixtures/fixture-host"
import { createInputBus } from "../../../../clients/portal/src/input/bus"
import { createKeyboardAdapter } from "../../../../clients/portal/src/input/keyboard-adapter"
import { createSpatialFocusController } from "../../../../clients/portal/src/input/spatial-focus"

export const name = "Home by d-pad, A and B"
export const note = "Pico on the portal's own input: the arrow keys are the d-pad, Enter is A, Escape is B"

/**
 * The surface as the portal mounts it: its keyboard adapter and spatial focus
 * on one input bus, and every action on the bus delivered to the surface.
 */
export default function HomeByDpad() {
  const [host] = useState(createFixtureHost)
  useEffect(() => {
    const bus = createInputBus()
    bus.use(createKeyboardAdapter())
    const offFocus = createSpatialFocusController(bus)
    const offHost = bus.on(action => {
      if (action.type === "back" || action.type === "options" || action.type === "menu" || action.type === "system") host.press(action.type)
    })
    return () => { offHost(); offFocus(); bus.dispose() }
  }, [host])
  return <PicoSurface host={host} model={fixtureModel} />
}

type Press = (element: Element, key: string) => Promise<void>
const SWEEP = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]
const focused = (): Element => document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
const label = (element: Element) => `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`

/** Arrow keys only: sweep down, right, up and left until focus rests on a control the pattern names. */
async function seek(press: Press, pattern: RegExp): Promise<Element | null> {
  let presses = 0
  for (let round = 0; round < 3; round++) {
    for (const key of SWEEP) {
      for (let step = 0; step < 10; step++) {
        const before = focused()
        await press(before, key)
        presses++
        const after = focused()
        if (after !== document.body && pattern.test(label(after))) return after
        if (after === before || presses > 90) break
      }
    }
  }
  return null
}

/** Reach a control by the d-pad from Home; if none, press B once at Home and look again. */
async function reach(press: Press, pattern: RegExp): Promise<Element | null> {
  const first = await seek(press, pattern)
  if (first) return first
  await press(focused(), "Escape")
  return seek(press, pattern)
}

export const checks = {
  default: {
    "the d-pad and A open Settings, and B returns to Home": async ({ input, expect, waitFor }) => {
      const entry = await reach(input.press, /settings/i)
      expect(entry, "No control named Settings is reachable with the d-pad from Home, before or after one B.").not.toBeNull()
      await input.press(focused(), "Enter")
      await waitFor(() => expect(document.querySelector(".pico-panel-screen"), "A on the Settings control did not open Settings.").not.toBeNull())
      await input.press(focused(), "Escape")
      await waitFor(() => expect(document.querySelector(".pico-cart-shelf"), "B in Settings did not return to Home.").not.toBeNull())
    },
    "the d-pad and A open Find": async ({ input, expect, waitFor }) => {
      const entry = await reach(input.press, /find/i)
      expect(entry, "No control named Find is reachable with the d-pad from Home, before or after one B.").not.toBeNull()
      await input.press(focused(), "Enter")
      await waitFor(() => expect(document.querySelector(".pico-library-browser"), "A on the Find control did not open Find.").not.toBeNull())
    },
  },
}
