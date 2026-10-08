#!/usr/bin/env node
import { readFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const tag = process.env.GITHUB_REF_NAME

if (process.env.GITHUB_REF_TYPE !== "tag" || tag !== `v${version}`) {
  console.error(`Refusing to publish: expected tag v${version}, got ${process.env.GITHUB_REF_TYPE ?? "no ref type"} ${tag ?? "no ref name"}.`)
  process.exit(1)
}

console.log(`Release tag ${tag} matches package version ${version}.`)
