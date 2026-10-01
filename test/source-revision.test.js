// @ts-check
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createSourceRevision } from "../src/checks/source-revision.js"
import { createTakeStore } from "../src/takes/store.js"

test("source revisions retain observed edits after content is restored and exclude generated check evidence", () => {
  const root = mkdtempSync("/tmp/caliper-source-revision-")
  try {
    mkdirSync(join(root, "src"))
    const path = join(root, "src/A.part.tsx")
    writeFileSync(path, "export default () => null")
    const store = createTakeStore(root)
    const revision = createSourceRevision({ root, store })
    const initial = revision.revision({})
    writeFileSync(path, "export default () => 'changed'")
    revision.invalidate(path)
    writeFileSync(path, "export default () => null")
    revision.invalidate(path)
    const restored = revision.revision({})
    expect(restored.fingerprint).toBe(initial.fingerprint)
    expect(restored.generation).toBeGreaterThan(initial.generation)
    mkdirSync(join(root, ".caliper/checks"), { recursive: true })
    writeFileSync(join(root, ".caliper/checks/report.json"), "evidence")
    revision.invalidate(join(root, ".caliper/checks/report.json"))
    expect(revision.revision({})).toEqual(restored)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("direnv cache links do not enter source identity while linked product sources still do", () => {
  const root = mkdtempSync("/tmp/caliper-direnv-revision-")
  const external = mkdtempSync("/tmp/caliper-direnv-input-")
  try {
    const input = join(external, "input.nix")
    writeFileSync(input, "initial input")
    mkdirSync(join(root, ".direnv/flake-inputs"), { recursive: true })
    symlinkSync(external, join(root, ".direnv/flake-inputs/source"), "dir")
    writeFileSync(join(root, "flake.lock"), "initial lock")
    const revision = createSourceRevision({ root, store: createTakeStore(root) })
    const initial = revision.revision({})
    writeFileSync(input, "changed input")
    revision.invalidate(join(root, ".direnv/flake-inputs/source/input.nix"))
    expect(revision.revision({})).toEqual(initial)

    symlinkSync(external, join(root, "shared"), "dir")
    const linked = revision.revision({})
    writeFileSync(input, "changed linked product source")
    revision.invalidate(join(root, "shared/input.nix"))
    expect(revision.revision({}).fingerprint).not.toBe(linked.fingerprint)
    expect(revision.stamp({}).generation).toBeGreaterThan(linked.generation)

    const beforeLock = revision.revision({})
    writeFileSync(join(root, "flake.lock"), "changed lock")
    revision.invalidate(join(root, "flake.lock"))
    expect(revision.revision({}).fingerprint).not.toBe(beforeLock.fingerprint)
    expect(revision.stamp({}).generation).toBeGreaterThan(beforeLock.generation)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})

test("take revisions include selected overlay edits without invalidating an unrelated take", () => {
  const root = mkdtempSync("/tmp/caliper-take-revision-")
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/A.part.tsx"), "export default () => null")
    const store = createTakeStore(root)
    const first = store.create({ part: "src/A.part.tsx", state: "default", device: "iphone-16" })
    const second = store.create({ part: "src/A.part.tsx", state: "default", device: "iphone-16" })
    const revision = createSourceRevision({ root, store })
    const original = revision.revision({}), before = revision.revision({ take: first }), other = revision.revision({ take: second })
    store.write(first, "src/A.part.tsx", "export default () => 'take'")
    revision.invalidate(join(root, ".caliper/takes", first, "src/A.part.tsx"))
    expect(revision.revision({ take: first }).generation).toBeGreaterThan(before.generation)
    expect(revision.revision({ take: first }).fingerprint).not.toBe(before.fingerprint)
    expect(revision.revision({ take: second })).toEqual(other)
    expect(revision.revision({})).toEqual(original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
