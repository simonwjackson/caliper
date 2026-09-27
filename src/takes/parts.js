// @ts-check
import { readPart, PART_SUFFIX } from "../derive/parts.js"

/**
 * A proposal can add its own preview state or part before acceptance. Derive
 * it from the take, not from the original file or a browser-supplied export.
 * @param {import('./store.js').TakeStore} store
 * @param {string} take
 * @param {readonly import('../types').Part[]} originals
 */
export function takeParts(store, take, originals) {
  if (store.record(take) === null) throw new Error(`Take ${take} does not exist.`)
  const parts = new Map(originals.map(part => [part.file, part]))
  for (const file of store.files(take)) {
    if (file.endsWith(PART_SUFFIX)) parts.set(file, readPart(store.root, file, store.read(take, file)))
  }
  return [...parts.values()]
}
