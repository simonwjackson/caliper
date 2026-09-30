import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import Chrome from "../src/client/ui/Chrome"
import { CAL, calSelector } from "../src/client/ui/hooks"
import { contractViews, readyView } from "./fixtures/chrome-view"
import { createChromeScenario } from "./fixtures/chrome-scenario"

const require = createRequire(import.meta.url)
test("contract examples render every declared behavioral hook across their applicable states", () => {
  const found = new Set<string>()
  for (const view of Object.values(contractViews())) {
    const scenario = createChromeScenario(view)
    const html = renderToStaticMarkup(createElement(Chrome, { view, actions: scenario.actions }))
    for (const match of html.matchAll(/data-cal="([^"]+)"/g)) if (match[1]) found.add(match[1])
  }
  expect(Object.values(CAL).filter(hook => !found.has(hook))).toEqual([])
  expect(new Set(Object.values(CAL)).size).toBe(Object.values(CAL).length)
  expect(calSelector(CAL.accept)).toBe('[data-cal="take-accept"]')
})
test("local scenario updates explicit inputs without mutating the original snapshot", () => {
  const initial = readyView()
  const scenario = createChromeScenario(initial)
  scenario.actions.onPrompt("New words")
  expect(scenario.getView().composer.prompt).toBe("New words")
  expect(initial.composer.prompt).toBe("Make the button quiet")
  expect(scenario.calls.at(-1)).toEqual({ name: "onPrompt", args: ["New words"] })
})
test("shared seam has no runtime imports or references to live app wiring", () => {
  const contract = readFileSync(new URL("../src/client/ui/contract.ts", import.meta.url), "utf8")
  expect(contract.match(/^import (?!type)/gm)).toBeNull()
  expect(contract).not.toContain("client/app/")
  const renderer = readFileSync(new URL("../src/client/ui/Chrome.tsx", import.meta.url), "utf8")
  expect(renderer).not.toMatch(/\b(fetch|localStorage|EventSource)\b/)
  expect(renderer).not.toContain('from "../app/')
})
test("contract positive and negative type probes pass with library checking", () => {
  const output = execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "false", "--jsx", "preserve",
    "--allowJs", "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022",
    "--types", "node", "test/chrome-contract-types.ts",
  ], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30_000 })
  expect(output).toBe("")
}, 35_000)
