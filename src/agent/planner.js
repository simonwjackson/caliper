// @ts-check
import { Type } from "typebox"
import { plannerSkillNote } from "./skills.js"
import { imageContent } from "./images.js"

/**
 * The planner turns one prompt into several different directions, so the
 * takes that run in parallel try different things. Each take's agent then
 * follows one direction. The planner may return fewer directions than asked
 * for when the prompt has one sensible answer; it says why in `note`.
 *
 * @typedef {import("./model.js").Engine} Engine
 * @typedef {import("../types").Direction} Direction
 * @typedef {import("../types").TakePlan} TakePlan
 * @typedef {{ type: "text", text: string } | { type: "image", data: string, mimeType: string }} Content
 */

export const PLAN_TOOL = "propose_directions"
const TITLE_LIMIT = 60
const BRIEF_LIMIT = 600

const planTool = {
  name: PLAN_TOOL,
  description: "Propose the directions for the takes. Call it exactly once.",
  parameters: Type.Object({
    directions: Type.Array(Type.Object({
      title: Type.String({ description: "Two to five words that name the direction" }),
      brief: Type.String({ description: "One to three sentences: what this take changes, where, and how it differs from the others" }),
    }), { minItems: 1 }),
    note: Type.Optional(Type.String({ description: "Only when you return fewer directions than asked for: why" })),
  }),
}

/**
 * @param {{
 *   engine: Engine,
 *   prompt: string,
 *   count: number,
 *   part: string,
 *   state: string,
 *   device: string,
 *   context: Content[],
 *   images?: readonly import("./images.js").AttachedImage[],
 *   preview?: import("../types").StateRef,
 *   skills?: import("./skills.js").SkillCatalog,
 *   signal?: AbortSignal,
 * }} input
 *   `context` is what the planner sees of the part: its source and how it renders now.
 *   `skills` are the skills the take agents can load; a brief can name one.
 *   `images` are what you attached to the prompt, as reference material.
 * @returns {Promise<TakePlan>}
 */
export async function planDirections({ engine, prompt, count, part, state, device, context, images = [], preview, skills, signal }) {
  const { models, model, reasoning } = engine
  const message = await models.completeSimple(model, {
    systemPrompt: `${systemPrompt(count)}${skills ? plannerSkillNote(skills) : ""}`,
    tools: [planTool],
    messages: [{
      role: "user",
      timestamp: Date.now(),
      content: [
        { type: "text", text: `The user's request: ${prompt}\n\nPropose up to ${count} directions. The editing subject is ${part}, state "${state}". The preview is ${preview?.part ?? part}, state "${preview?.state ?? state}", on ${device}.${preview ? " This is a product-owned composed scenario. Plan changes to the subject, not a replacement of the page with its standalone fixture." : ""}` },
        ...context,
        ...imageContent(images, "this prompt"),
      ],
    }],
  }, {
    // pi-ai takes no "off" level; leaving reasoning out turns it off.
    ...(reasoning === "off" ? {} : { reasoning }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(`The planner failed: ${message.errorMessage ?? message.stopReason}`)
  }
  const call = message.content.find(block => block.type === "toolCall" && block.name === PLAN_TOOL)
  if (call === undefined || call.type !== "toolCall") throw new Error("The planner did not propose any directions.")
  return cleanPlan(call.arguments, count)
}

/**
 * Keep the planner's answer inside the contract: 1 to `count` directions,
 * each with a title and a brief, no two with the same title.
 *
 * @param {unknown} raw
 * @param {number} count
 * @returns {TakePlan}
 */
export function cleanPlan(raw, count) {
  const input = /** @type {{ directions?: unknown, note?: unknown }} */ (raw ?? {})
  const seen = new Set()
  /** @type {Direction[]} */
  const directions = []
  for (const item of Array.isArray(input.directions) ? input.directions : []) {
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, TITLE_LIMIT) : ""
    const brief = typeof item?.brief === "string" ? item.brief.trim().slice(0, BRIEF_LIMIT) : ""
    if (title === "" || brief === "" || seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    directions.push({ title, brief })
    if (directions.length === count) break
  }
  if (directions.length === 0) throw new Error("The planner proposed no usable directions.")
  const note = typeof input.note === "string" && input.note.trim() !== "" && directions.length < count ? input.note.trim() : undefined
  return note === undefined ? { directions } : { directions, note }
}

/** @param {number} count */
function systemPrompt(count) {
  return `You plan takes inside Caliper, a tool that shows a React project's UI parts at the true size of handheld devices. A take is one proposed version of a part; an AI agent makes each take on its own, in parallel, and the user compares them side by side.

The user asked for ${count} takes of one request. Your job is to make them different in a way that is useful to compare. Propose up to ${count} directions, one per take.

A good set of directions:
- Each direction is a real, reasonable answer to the request, not a strawman.
- They differ in approach, not only in degree: different structure, different source of data, different emphasis, different trade-off. "Red" and "darker red" are one direction.
- Each brief says concretely what that take changes (which component, CSS or example data) and how it differs from the others. Each agent sees only its own brief and the titles of the others.
- When the preview differs from the editing subject, preserve the preview's real composition and fixture data flow. The scenario is where changes are judged, not permission to change unrelated components.

Return fewer directions when the request has only one or two sensible answers, for example a precise fix or a narrow data change. Never invent a direction only to fill the count. When you return fewer, say why in one sentence in note.

You see the part's source and a screenshot. You cannot read other files; the agents will. Call ${PLAN_TOOL} exactly once, and write nothing else.`
}
