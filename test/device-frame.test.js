// @ts-check
import { describe, expect, test } from "bun:test"
import { DEVICES, frameGeometry, gridGeometry } from "../src/client/device-frame.js"

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

describe("DEVICES", () => {
  test("has the two target handhelds, with unique ids", () => {
    expect(DEVICES.map(device => device.name)).toEqual(["RG353M", "ODIN 2 PORTAL"])
    expect(new Set(DEVICES.map(device => device.id)).size).toBe(DEVICES.length)
  })
})
