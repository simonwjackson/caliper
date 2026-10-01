#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#imagemagick --command node
// Write the real Pico renders and check images of the slice 2 spike as WebP
// data URLs, for the gallery's workspace-rows fixtures. Inputs come from
// check-spike.sh and render-cells.sh. Usage: gen-rows-fixture.mjs <output .ts>
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const target = process.argv[2]
if (!target) throw new Error("Name the output file.")
const cells = "/tmp/s2-spike/cells"
const work = mkdtempSync(join(tmpdir(), "rows-fixture-"))
const webp = (png, width = 279, height = 209) => {
  const out = join(work, `${Math.random().toString(36).slice(2)}.webp`)
  execFileSync("magick", [png, "-filter", "Lanczos", "-resize", `${width}x${height}!`, "-quality", "82", out])
  return `data:image/webp;base64,${readFileSync(out).toString("base64")}`
}
const columns = ["today", "5", "6", "7"]
const rows = ["home", "find", "settings", "dpad"]
const lines = ["/**",
  " * Pico on the RG353M, 279 x 209 px: real renders of Pico's workspace 1 and its",
  " * ideas, takes 5 to 7, made by the workspaces slice 2 spike on 2026-10-01 with",
  " * caliper-render. `proof` is the page at the end of each d-pad check, in the",
  " * check's order. Fixture data only. Generated; do not edit by hand.",
  " */",
  "export const PICO_ROWS_BOARD = {"]
for (const column of columns) {
  lines.push(`  ${JSON.stringify(column)}: {`)
  for (const row of rows) lines.push(`    ${row}: ${JSON.stringify(webp(join(cells, column, `${row}.png`)))},`)
  const report = readdirSync(join("/tmp/s2-spike", `out-${column}`)).map(dir => join("/tmp/s2-spike", `out-${column}`, dir, "report.json"))[0]
  const checks = JSON.parse(readFileSync(report, "utf8")).results[0].authored.checks
  lines.push(`    proof: [${checks.map(check => JSON.stringify(webp(check.image, 320, 240))).join(", ")}],`)
  lines.push("  },")
}
lines.push("} as const", "")
writeFileSync(target, lines.join("\n"))
console.log(`wrote ${target} ${readFileSync(target).length} bytes`)
