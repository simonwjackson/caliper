// @ts-check
import { discoverParts } from "../derive/parts.js"
import { takeParts } from "../takes/parts.js"

/** Derive check identity from product syntax, never by importing consumer code.
 * @param {{store:import('../takes/store.js').TakeStore, revision:ReturnType<typeof import('../checks/source-revision.js').createSourceRevision>, take?:string}} input
 * @returns {import('./contract.js').CheckSource}
 */
export function checkSource({ store, revision, take }) {
  const originals = discoverParts(store.root)
  const parts = take === undefined ? originals : takeParts(store, take, originals)
  /** @param {readonly import('../types').Part[]} parts */
  const declarations = parts =>
    new Map(
      parts.flatMap(part =>
        Object.entries(part.authoredChecks ?? {}).flatMap(([state, checks]) =>
          checks.map(check => [`${part.file}#${state}#${check.name}`, check.hash]),
        ),
      ),
    )
  const before = declarations(originals),
    after = declarations(parts)
  return {
    root: store.root,
    revision: revision.revision({ take }),
    provenance: {
      kind: take === undefined ? "Original" : "Take",
      ...(take === undefined ? {} : { take }),
      files: take === undefined ? [] : store.files(take),
      changedDeclarations:
        take === undefined
          ? []
          : [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key)),
    },
    parts: parts.map(part => ({
      file: part.file,
      authoredChecks: Object.fromEntries(
        Object.entries(part.authoredChecks ?? {}).map(([state, checks]) => [state, [...checks]]),
      ),
      authoredCheckProblems: [...(part.authoredCheckProblems ?? [])],
    })),
  }
}
