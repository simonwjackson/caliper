// @ts-check
/**
 * The first message of a take made from marks, as text. Pure: Caliper builds
 * it from take records, so it survives a restart and needs no conversation.
 * The pictures follow it as images, in the order the brief lists them.
 *
 * @typedef {import("../takes/store.js").TakeRecord} TakeRecord
 * @typedef {import("../takes/store.js").TakeIdentity} TakeIdentity
 * @typedef {import("../takes/marks-contract.js").Mark} Mark
 * @typedef {import("../takes/marks-contract.js").MarkElement} MarkElement
 * @typedef {{
 *   preview: import("../types").StateRef, previewLabel: string, deviceLabel: string,
 *   width: number, height: number, drawn: string[], missing: string[], outside: string[],
 * }} Picture
 *   One picture of the parent with marks drawn in. Letters: `drawn` are all
 *   the marks on it; `missing` were not found in the fresh render; `outside`
 *   lie outside the visible screen.
 * @typedef {{ source: TakeIdentity, mark: Mark, crop: boolean }} Reference
 *   A mark on another take, or on the original (take "0"), that a note of this
 *   pass points to. `crop`: a picture of that take around the mark follows the
 *   pictures, in the order the brief lists references.
 */

/**
 * @param {{
 *   take: string,
 *   record: import("../takes/store.js").NewStateTakeRecord & { parent?: TakeIdentity, history: import("../takes/store.js").TakeHistory, marks: Mark[] },
 *   pictures: readonly Picture[],
 *   sources: ReadonlyArray<{ path: string, content: string }>,
 *   references?: readonly Reference[],
 * }} input
 *   A record with no `parent` is a take made from marks on the original: a copy of the real files.
 * @returns {string}
 */
export function markupMessage({ take, record, pictures, sources, references = [] }) {
  const parent = record.parent?.take ?? "0"
  const fromOriginal = record.parent === undefined
  const copy = fromOriginal ? "the real files" : `take ${parent}`
  const { history } = record
  const readable = [...new Set(references.filter(reference => reference.source.take !== "0").map(reference => reference.source.take))]
  const crops = references.filter(reference => reference.crop)
  const sections = [
    fromOriginal
      ? `You are take ${take}, a new take made from the real files. The user marked places on the original and wrote a note at each one. Work on the marks of this pass.`
      : `You are take ${take}, a copy of take ${parent}. The user marked places on take ${parent} and wrote a note at each one. Work on the marks of this pass.`,
    section("Lineage", fromOriginal ? `Take ${take} starts from the real files. It has no parent take.` : lineage(take, history.lineage)),
    section("First prompt", history.prompt === null ? fromOriginal ? "None. This take started from marks on the original." : `Not recorded. Take ${history.lineage[0]?.take ?? parent} was made before Caliper kept first prompts.` : quote(history.prompt)),
    ...(history.direction ? [section("Direction", `${history.direction.title}. ${history.direction.brief}`)] : []),
    ...history.passes.map(pass => section(`Marks on take ${pass.source.take} (an earlier pass)`, pass.marks.map(mark => markText(pass.source.take, mark)).join("\n"))),
    section(`Marks on ${fromOriginal ? "the original" : `take ${parent}`} (this pass)`, record.marks.map(mark => markText(parent, mark)).join("\n")),
    ...(references.length ? [section("Marks the notes point to", [
      ...references.map(reference => markText(reference.source.take, reference.mark)),
      referenceAccess(readable),
    ].join("\n"))] : []),
    section("Pictures", [
      ...pictures.map((picture, index) => pictureText(parent, picture, index)),
      ...crops.map((reference, index) => `Picture ${pictures.length + index + 1}: ${reference.source.take === "0" ? "the real files" : `take ${reference.source.take}`} around ${reference.source.take}${reference.mark.letter}, with the marks drawn in.`),
    ].join("\n")),
    section("May write", `.caliper/takes/${take}, a copy of ${copy}. Nowhere else. ${fromOriginal ? "The real files do not change" : `Take ${parent} does not change`}${readable.length ? `, and neither ${readable.length === 1 ? "does" : "do"} ${readable.map(item => `take ${item}`).join(" or ")}` : ""}.`),
    section("How to work", [
      "- Each note says, in the user's words, what they like or dislike at that place. Keep what a note likes. Change what a note dislikes.",
      ...(references.length ? ["- A note that names another mark (\"use 2A here\") asks you to bring what that mark shows into this take. Read that take's code, then write the change here."] : []),
      "- Marks of earlier passes are context. Do not undo what they asked for unless a mark of this pass asks for it.",
      `- The editing subject is ${record.part}, state "${record.state}". ${record.context ? `The preview is the composed scenario ${record.context.part}, state "${record.context.state}". Keep its real composition and fixture data flow.` : "The preview shows the subject in isolation."}`,
      "- The selector and text of a mark's element say where it was. Find that element in the source before you change it.",
      "- Call render after each change, and render with related:true before you finish. Say which marks you handled and what you could not do.",
    ].join("\n")),
    ...sources.map(source => `<file path="${source.path}">\n${source.content}\n</file>`),
  ]
  return sections.join("\n\n")
}

/**
 * Planner choice 14: marks on the original that go with a typed prompt, as text
 * appended to it. The picture of the real files with the marks drawn in is
 * attached to the prompt as an image.
 * @param {readonly Mark[]} marks
 * @returns {string}
 */
export function promptMarksText(marks) {
  return [
    "",
    "## Marks on the original",
    "The user marked places on the real files and wrote a note at each one. The attached picture named original-…-marks.png shows them. Keep what a note likes; change what a note dislikes.",
    ...marks.map(mark => markText("0", mark)),
  ].join("\n")
}

/** @param {readonly string[]} takes the referenced takes the agent may read */
function referenceAccess(takes) {
  const original = "Marks named 0A, 0B and so on are on the real files, which read_file reads by default."
  if (!takes.length) return original
  return `You may read ${takes.map(item => `take ${item}`).join(" and ")} with read_file and list_files and take: "${takes[0]}". You cannot write there. ${original}`
}

/** @param {string} title @param {string} body */
function section(title, body) {
  return `## ${title}\n${body}`
}

/** @param {string} text */
function quote(text) {
  return text.split("\n").map(line => `> ${line}`).join("\n")
}

/** @param {string} take @param {readonly TakeIdentity[]} lineage oldest first, ending with the parent */
function lineage(take, lineage) {
  const [parent, ...earlier] = [...lineage].reverse()
  if (!parent) return `Take ${take} has no recorded parent.`
  return `Take ${take} continues take ${parent.take}${earlier.map(item => `, which continued take ${item.take}`).join("")}.`
}

/** @param {string} take @param {Mark} mark */
function markText(take, mark) {
  const { anchor } = mark
  const lines = [`${take}${mark.letter}: ${mark.note.trim() ? mark.note.trim() : "(no note)"}`]
  lines.push(`   ${anchor.kind === "Region" ? "region inside" : "element"}: ${elementText(anchor.element)}`)
  if (anchor.kind === "Region") {
    lines.push(`   region: ${round(anchor.rect.width)} × ${round(anchor.rect.height)} CSS px at ${round(anchor.rect.x)}, ${round(anchor.rect.y)} from the page's top left`)
    if (anchor.elements.length) lines.push(`   contains: ${anchor.elements.map(elementText).join("; ")}`)
  } else {
    lines.push(`   point: ${round(anchor.rect.x)}, ${round(anchor.rect.y)} CSS px from the page's top left`)
  }
  if (anchor.afterInput) lines.push("   Placed after input, such as a click that opened a menu. The picture shows the state before that input.")
  return lines.join("\n")
}

/** @param {MarkElement} element */
function elementText(element) {
  const name = `${element.tag}${element.classes.map(item => `.${item}`).join("")}`
  return `${name}${element.text ? ` “${element.text}”` : ""} (selector ${element.selector})`
}

/** @param {string} parent @param {Picture} picture @param {number} index */
function pictureText(parent, picture, index) {
  const names = (/** @type {readonly string[]} */ letters) => letters.map(letter => `${parent}${letter}`).join(", ")
  const notes = [
    picture.missing.length ? ` Not found in this render, drawn where they were placed: ${names(picture.missing)}.` : "",
    picture.outside.length ? ` Outside the visible screen: ${names(picture.outside)}.` : "",
  ].join("")
  return `Picture ${index + 1}: take ${parent}, ${picture.previewLabel}, on ${picture.deviceLabel} at ${picture.width} × ${picture.height} CSS px, with ${names(picture.drawn)} drawn in.${notes}`
}

/** @param {number} value */
function round(value) {
  return Math.round(value)
}
