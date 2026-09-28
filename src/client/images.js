// @ts-check

/**
 * What a prompt may carry as images, in one place. The chrome checks a file
 * when you attach it, so you hear about a problem at once. The server checks
 * again with the same rules, and also checks the bytes, because it does not
 * trust the browser's type.
 *
 * Model APIs accept these four types. SVG is not one of them.
 *
 * @typedef {"image/png" | "image/jpeg" | "image/webp" | "image/gif"} ImageType
 */

/** @type {Readonly<Record<ImageType, { label: string, extension: string }>>} */
export const IMAGE_TYPES = Object.freeze({
  "image/png": { label: "PNG", extension: "png" },
  "image/jpeg": { label: "JPEG", extension: "jpg" },
  "image/webp": { label: "WebP", extension: "webp" },
  "image/gif": { label: "GIF", extension: "gif" },
})

/** The most images one prompt carries. Each take of a plan sends all of them. */
export const MAX_IMAGES = 4
/** The largest image, in bytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** The longest name the chrome shows and the model reads. */
export const MAX_IMAGE_NAME = 120

/** @param {string} type @returns {type is ImageType} */
export function isImageType(type) {
  return Object.hasOwn(IMAGE_TYPES, type)
}

/**
 * Why a file cannot be attached, or null when it can.
 *
 * @param {{ name: string, type: string, size: number }} file
 * @returns {string | null}
 */
export function imageProblem({ name, type, size }) {
  if (!isImageType(type)) return `"${name}" is not a PNG, JPEG, WebP or GIF image.`
  if (size > MAX_IMAGE_BYTES) return `"${name}" is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
  if (size === 0) return `"${name}" is empty.`
  return null
}

/**
 * The type the first bytes of an image show, or null.
 *
 * @param {Uint8Array} bytes
 * @returns {ImageType | null}
 */
export function sniffImageType(bytes) {
  /** @param {number[]} signature @param {number} [at] */
  const starts = (signature, at = 0) => signature.every((byte, index) => bytes[at + index] === byte)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg"
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif"
  // "RIFF", a size, then "WEBP".
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"
  return null
}

/**
 * A name that is safe to show and to give the model: one line, not too long.
 *
 * @param {string} name
 */
export function imageName(name) {
  const clean = name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_IMAGE_NAME)
  return clean === "" ? "image" : clean
}
