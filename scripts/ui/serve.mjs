#!/usr/bin/env -S nix develop -c node
// @ts-check
/** Serve the Darkroom gallery for a person to look at: PORT=5313 scripts/ui/serve.mjs, then open /?fixture=takes. */
import { serveGallery } from "./lib.mjs"
import { FIXTURE_NAMES } from "./fixtures.mjs"

const gallery = await serveGallery()
console.log(`Darkroom gallery at ${gallery.origin}/?fixture=takes`)
for (const name of FIXTURE_NAMES) console.log(`  ${gallery.origin}/?fixture=${name}`)
process.on("SIGINT", () => { void gallery.close().then(() => process.exit(0)) })
