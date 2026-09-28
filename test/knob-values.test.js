// @ts-check
import { describe, expect, test } from "bun:test"
import { controlFor, formatNumber, labelFor, mergeHints, namespaceOf, parseSyntax, scrub, sentinelFor } from "../src/client/knob-values.js"

describe("the control a registered property gets", () => {
  test("a length or a number scrubs, with a step from its written precision and no range", () => {
    expect(controlFor({ syntax: "<number>", value: "360", hints: {} })).toEqual({ _tag: "Number", number: 360, unit: "", step: 1 })
    expect(controlFor({ syntax: "<length>", value: "2px", hints: {} })).toEqual({ _tag: "Number", number: 2, unit: "px", step: 1 })
    expect(controlFor({ syntax: "<number>", value: "1.35", hints: {} })).toEqual({ _tag: "Number", number: 1.35, unit: "", step: 0.01 })
    expect(controlFor({ syntax: "<length>", value: "-2.5cqi", hints: {} })).toEqual({ _tag: "Number", number: -2.5, unit: "cqi", step: 0.1 })
  })

  test("hints give the range and the step", () => {
    expect(controlFor({ syntax: "<number>", value: "360", hints: { min: 180, max: 720, step: 10 } }))
      .toEqual({ _tag: "Number", number: 360, unit: "", step: 10, min: 180, max: 720 })
  })

  test("a colour is a colour field; a reference to another token is a token picker", () => {
    expect(controlFor({ syntax: "<color>", value: "#FF77A8", hints: {} })).toEqual({ _tag: "Color", value: "#FF77A8", hex: "#ff77a8" })
    expect(controlFor({ syntax: "<color>", value: "#fab", hints: {} })).toEqual({ _tag: "Color", value: "#fab", hex: "#ffaabb" })
    expect(controlFor({ syntax: "<color>", value: "rgb(1 2 3)", hints: {} })).toEqual({ _tag: "Color", value: "rgb(1 2 3)", hex: null })
    expect(controlFor({ syntax: "<color>", value: "var(--p8-black)", hints: {} })).toEqual({ _tag: "Token", token: "--p8-black", namespace: "--p8-" })
  })

  test("an ident union is a choice", () => {
    expect(controlFor({ syntax: "small | medium | large", value: "medium", hints: {} })).toEqual({ _tag: "Choice", options: ["small", "medium", "large"], value: "medium" })
  })

  test("an output, a mix of tokens, and a syntax with no control are skipped with the reason", () => {
    expect(controlFor({ syntax: "<length>", value: "max(var(--a), round(down, calc(1px * 2), 1px))", hints: {} }))
      .toEqual({ _tag: "Skip", reason: "Computed with max(), so it is an output, not an input." })
    expect(controlFor({ syntax: "<length>", value: "clamp(1px, 2vw, 3px)", hints: {} })._tag).toBe("Skip")
    expect(controlFor({ syntax: "*", value: "var(--a) var(--b)", hints: {} }))
      .toEqual({ _tag: "Skip", reason: "Combines other tokens: var(--a) var(--b)." })
    expect(controlFor({ syntax: "<length>+", value: "1px 2px", hints: {} }))
      .toEqual({ _tag: "Skip", reason: "Caliper has no control for the syntax <length>+ yet." })
    expect(controlFor({ syntax: "<length>", value: "auto", hints: {} }))
      .toEqual({ _tag: "Skip", reason: "auto is not a number Caliper can scrub." })
    expect(controlFor({ syntax: "a | b", value: "c", hints: {} }))
      .toEqual({ _tag: "Skip", reason: "c is not one of a, b." })
  })

  test("a hint can hide any of them", () => {
    expect(controlFor({ syntax: "<number>", value: "3", hints: { ignore: true } })).toEqual({ _tag: "Skip", reason: "Hidden by @knob ignore." })
  })
})

describe("reading a syntax", () => {
  test("names the types Caliper has controls for", () => {
    expect(parseSyntax(" <length-percentage> ")).toEqual({ _tag: "Number", type: "length-percentage" })
    expect(parseSyntax("<color>")).toEqual({ _tag: "Color" })
    expect(parseSyntax("auto|none")).toEqual({ _tag: "Idents", options: ["auto", "none"] })
    expect(parseSyntax("*")).toEqual({ _tag: "Any" })
    expect(parseSyntax("<length> | auto")).toEqual({ _tag: "Other", syntax: "<length> | auto" })
  })
})

describe("knockout sentinels", () => {
  test("are valid for the registered syntax and differ from the current value", () => {
    expect(sentinelFor("<color>", "#000")).toBe("rgb(1, 2, 3)")
    expect(sentinelFor("<length>", "2px")).toBe("4321px")
    expect(sentinelFor("<number>", "360")).toBe("4321")
    expect(sentinelFor("a | b", "a")).toBe("b")
    expect(sentinelFor("a", "a")).toBe(null)
    expect(sentinelFor("*", "x")).toBe("caliper-knockout")
  })
})

describe("scrubbing", () => {
  test("moves one step for each 2 px of drag, and stays inside the hinted range", () => {
    expect(scrub({ number: 360, unit: "", step: 1 }, 20)).toBe(370)
    expect(scrub({ number: 360, unit: "", step: 10, min: 180, max: 720 }, 1000)).toBe(720)
    expect(scrub({ number: 360, unit: "", step: 10, min: 180, max: 720 }, -1000)).toBe(180)
    expect(scrub({ number: 1.35, unit: "", step: 0.01 }, 6)).toBe(1.38)
  })

  test("writes a number with the step's precision and the unit", () => {
    expect(formatNumber(1.3800000000000001, "", 0.01)).toBe("1.38")
    expect(formatNumber(4, "px", 1)).toBe("4px")
    expect(formatNumber(-0.5, "rem", 0.25)).toBe("-0.5rem")
  })
})

describe("names", () => {
  test("a label drops the project prefix, and a namespace is the first segment", () => {
    expect(labelFor("--pico-pixel-rows")).toBe("Pixel rows")
    expect(labelFor("--rows")).toBe("Rows")
    expect(namespaceOf("--p8-black")).toBe("--p8-")
    expect(namespaceOf("--gap")).toBe("--")
  })

  test("later hints win over earlier ones", () => {
    expect(mergeHints({ label: "A", min: 1 }, undefined, { label: "B" })).toEqual({ label: "B", min: 1 })
  })
})
