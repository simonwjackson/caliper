// @ts-check
import { describe, expect, test } from "bun:test"
import { HANDHELD_DEVICES, KNOWN_DEVICES, STANDARD_DEVICES, frameGeometry, gridGeometry, resolveDevices } from "../src/client/device-frame.js"

/** @type {import("../src/client/device-frame.js").Device} */
const device = {
  id: "test",
  name: "Test",
  widthMm: 100,
  heightMm: 50,
  cssWidth: 800,
  cssHeight: 400,
  viewportNote: "",
}
const pxPerMm = 4

describe("frameGeometry", () => {
  test("draws the device at its physical width when it fits", () => {
    expect(frameGeometry(device, pxPerMm, { width: 1000, height: 1000 })).toEqual({
      width: 400,
      height: 200,
      scale: 0.5,
      fit: { _tag: "TrueSize" },
    })
  })

  test("fits exactly at the true size", () => {
    expect(frameGeometry(device, pxPerMm, { width: 400, height: 200 }).fit).toEqual({ _tag: "TrueSize" })
  })

  test("scales down, and says so, when the room is too narrow", () => {
    const geometry = frameGeometry(device, pxPerMm, { width: 399, height: 1000 })
    expect(geometry.width).toBeCloseTo(399)
    expect(geometry.fit).toEqual({ _tag: "Scaled", percent: 99 })
  })

  test("scales down when the room is too short, keeping the aspect", () => {
    const geometry = frameGeometry(device, pxPerMm, { width: 1000, height: 100 })
    expect(geometry).toEqual({ width: 200, height: 100, scale: 0.25, fit: { _tag: "Scaled", percent: 50 } })
  })

  test("never draws a negative size in a collapsed room", () => {
    const geometry = frameGeometry(device, pxPerMm, { width: -20, height: 10 })
    expect(geometry.width).toBe(0)
    expect(geometry.fit).toEqual({ _tag: "Scaled", percent: 0 })
  })
})

describe("gridGeometry", () => {
  // Each frame at true size is 400 × 200. A gap of 20 and a caption of 30.
  const spacing = { gap: 20, caption: 30 }

  test("puts as many true-size frames in a row as fit", () => {
    const grid = gridGeometry(device, pxPerMm, { width: 1300, height: 600 }, 5, spacing)
    expect(grid.columns).toBe(3)
    expect(grid.frame.fit).toEqual({ _tag: "TrueSize" })
  })

  test("counts the gap only between frames", () => {
    expect(gridGeometry(device, pxPerMm, { width: 820, height: 600 }, 5, spacing).columns).toBe(2)
    expect(gridGeometry(device, pxPerMm, { width: 819, height: 600 }, 5, spacing).columns).toBe(1)
  })

  test("never makes more columns than frames", () => {
    expect(gridGeometry(device, pxPerMm, { width: 5000, height: 600 }, 2, spacing).columns).toBe(2)
  })

  test("keeps rows at true size and lets them scroll, when the rows do not fit the height", () => {
    const grid = gridGeometry(device, pxPerMm, { width: 400, height: 230 }, 6, spacing)
    expect(grid.columns).toBe(1)
    expect(grid.frame.fit).toEqual({ _tag: "TrueSize" })
  })

  test("scales every frame by the same amount when one frame does not fit", () => {
    const grid = gridGeometry(device, pxPerMm, { width: 200, height: 600 }, 3, spacing)
    expect(grid.columns).toBe(1)
    expect(grid.frame).toEqual({ width: 200, height: 100, scale: 0.25, fit: { _tag: "Scaled", percent: 50 } })
  })

  test("leaves room for the caption when it fits one frame to the height", () => {
    const grid = gridGeometry(device, pxPerMm, { width: 1000, height: 130 }, 2, spacing)
    expect(grid.frame.height).toBe(100)
  })
})

describe("STANDARD_DEVICES", () => {
  test("are a phone of each kind, a tablet, a laptop and a monitor, the iPhone first", () => {
    expect(STANDARD_DEVICES.map(device => device.name)).toEqual(["iPhone 16", "Pixel 7", "iPad Air 11″", "MacBook Air 13″", "24″ monitor"])
  })

  test("have a physical aspect that matches their CSS viewport within 1%", () => {
    for (const device of STANDARD_DEVICES) {
      expect(Math.abs((device.widthMm / device.heightMm) / (device.cssWidth / device.cssHeight) - 1)).toBeLessThan(0.01)
    }
  })

  test("have sizes from the makers' resolution and density", () => {
    const iphone = STANDARD_DEVICES[0]
    expect([iphone?.widthMm, iphone?.heightMm, iphone?.cssWidth, iphone?.cssHeight]).toEqual([65.1, 141.1, 393, 852])
  })

  test("share no id with the handhelds", () => {
    expect(new Set(KNOWN_DEVICES.map(device => device.id)).size).toBe(KNOWN_DEVICES.length)
    expect(HANDHELD_DEVICES.map(device => device.id)).toEqual(["rg353m", "odin2portal"])
  })
})

describe("resolveDevices", () => {
  test("gives the standard devices when the project sets none", () => {
    expect(resolveDevices(undefined)).toEqual({ _tag: "Resolved", devices: STANDARD_DEVICES })
  })

  test("takes known devices by id, in the project's order", () => {
    const list = resolveDevices(["odin2portal", "iphone-16"])
    expect(list._tag === "Resolved" && list.devices.map(device => device.id)).toEqual(["odin2portal", "iphone-16"])
  })

  test("takes a device the project declares, with a note that says where it came from", () => {
    const list = resolveDevices([{ id: "kiosk", name: "Kiosk", widthMm: 300, heightMm: 200, cssWidth: 1200, cssHeight: 800 }])
    expect(list._tag === "Resolved" && list.devices[0]).toEqual({ id: "kiosk", name: "Kiosk", widthMm: 300, heightMm: 200, cssWidth: 1200, cssHeight: 800, viewportNote: "Declared in the project's vite.config." })
  })

  test("refuses an unknown id and names the known ones", () => {
    const list = resolveDevices(["iphone"])
    expect(list._tag).toBe("Invalid")
    expect(list._tag === "Invalid" && list.reason).toContain('names "iphone"')
    expect(list._tag === "Invalid" && list.reason).toContain("iphone-16, pixel-7")
  })

  test("refuses an empty list, a device without sizes, and a repeated id", () => {
    expect(resolveDevices([])._tag).toBe("Invalid")
    expect(resolveDevices("iphone-16")._tag).toBe("Invalid")
    expect(resolveDevices([{ id: "x", name: "X", widthMm: 0, heightMm: 1, cssWidth: 1, cssHeight: 1 }])._tag).toBe("Invalid")
    const twice = resolveDevices(["rg353m", "rg353m"])
    expect(twice._tag === "Invalid" && twice.reason).toContain('"rg353m" twice')
  })
})
