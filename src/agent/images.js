// @ts-check
import { Type } from "typebox"
import { Check } from "typebox/value"
import { IMAGE_TYPES, imageName, imageProblem, MAX_IMAGE_BYTES, MAX_IMAGES, sniffImageType } from "../client/images.js"

/**
 * Images you attach to a prompt: how the takes API reads them from a request,
 * and how the model sees them.
 *
 * @typedef {import("../client/images.js").ImageType} ImageType
 * @typedef {{ name: string, mimeType: ImageType, bytes: Buffer }} AttachedImage
 *   One checked image. `bytes` match `mimeType`.
 * @typedef {{ type: "text", text: string } | { type: "image", data: string, mimeType: string }} Content
 */

/** Base64 of the largest image, and room for its name and type. */
const MAX_ENCODED = Math.ceil(MAX_IMAGE_BYTES / 3) * 4

/** The largest body of a request that carries images, in bytes. */
export const MAX_IMAGES_BODY = MAX_IMAGES * (MAX_ENCODED + 1024) + 64 * 1024

// The body limit bounds the data; the decoded size is checked below.
const wireImage = Type.Object({ name: Type.String(), mimeType: Type.String(), data: Type.String() })

/**
 * The images a request carries, checked. A request with no `images` carries none.
 *
 * @param {unknown} body
 * @returns {AttachedImage[]}
 */
export function readImages(body) {
  const raw = /** @type {Record<string, unknown>} */ (body ?? {}).images
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error("images must be a list.")
  if (raw.length > MAX_IMAGES) throw new Error(`A prompt can carry at most ${MAX_IMAGES} images.`)
  return raw.map(item => {
    if (!Check(wireImage, item)) throw new Error("Each image needs a name, a type and base64 data.")
    const name = imageName(item.name)
    const bytes = Buffer.from(item.data, "base64")
    const problem = imageProblem({ name, type: item.mimeType, size: bytes.length })
    if (problem !== null) throw new Error(problem)
    const mimeType = /** @type {ImageType} */ (item.mimeType)
    if (sniffImageType(bytes) !== mimeType) throw new Error(`"${name}" is not a ${IMAGE_TYPES[mimeType].label} image. Its bytes do not match its type.`)
    return { name, mimeType, bytes }
  })
}

/**
 * The images as the model sees them: one line that names them and says what
 * they are, then each image. Nothing when there are none.
 *
 * @param {readonly AttachedImage[]} images
 * @param {"this prompt" | "earlier prompts in this take"} source
 * @returns {Content[]}
 */
export function imageContent(images, source) {
  if (images.length === 0) return []
  const names = images.map(image => image.name).join(", ")
  return [
    { type: "text", text: `Images I attached to ${source}: ${names}. They are reference material, not the part as it renders now.` },
    ...images.map(image => /** @type {Content} */ ({ type: "image", data: image.bytes.toString("base64"), mimeType: image.mimeType })),
  ]
}

