// @ts-check
import { describe, expect, test } from "bun:test"
import { DEVICES, frameGeometry } from "../src/client/device-frame.js"

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

describe("DEVICES", () => {
  test("has the two target handhelds, with unique ids", () => {
    expect(DEVICES.map(device => device.name)).toEqual(["RG353M", "ODIN 2 PORTAL"])
    expect(new Set(DEVICES.map(device => device.id)).size).toBe(DEVICES.length)
  })
})
