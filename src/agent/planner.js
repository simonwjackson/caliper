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
 * With `STRANGE_FROM` or more takes, one direction is the strange one: a
 * real answer to the request that breaks the part's current pattern on
 * purpose, so the most probable answer is not the only one on the board.
 * It uses one of the takes, not an extra one. The planner may leave it out
 * for a precise fix, and says why in `note`.
 *
 * @typedef {import("./model.js").Engine} Engine
 * @typedef {import("../types").Direction} Direction
 * @typedef {import("../types").TakePlan} TakePlan
 * @typedef {{ type: "text", text: string } | { type: "image", data: string, mimeType: string }} Content
 */

export const PLAN_TOOL = "propose_directions"
const TITLE_LIMIT = 60
const BRIEF_LIMIT = 600
/** The smallest number of takes that has room for a strange direction. */
export const STRANGE_FROM = 3

const title = Type.String({ description: "Two to five words that name the direction" })
const brief = Type.String({ description: "One to three sentences: what this take changes, where, and how it differs from the others" })

/** The tool the planner answers through for a workspace's question. */
export const IDEAS_TOOL = "propose_ideas"

/**
 * The tool the planner answers through. It offers the strange mark only
 * when the plan has room for a strange direction. A workspace's plan also
 * names the workspace.
 *
 * @param {number} count
 * @param {boolean} [ideas] the plan is for a workspace's ideas, not takes of a part
 */
function planTool(count, ideas = false) {
  const withStrange = count >= STRANGE_FROM
  return {
    name: ideas ? IDEAS_TOOL : PLAN_TOOL,
    description: ideas ? "Propose the directions for the ideas, and name the workspace. Call it exactly once." : "Propose the directions for the takes. Call it exactly once.",
    parameters: Type.Object({
      ...(ideas ? { name: Type.Optional(Type.String({ description: "Two to five words that name the question, for the list of workspaces" })) } : {}),
      directions: Type.Array(withStrange
        ? Type.Object({ title, brief, strange: Type.Optional(Type.Boolean({ description: "True only on the one strange direction" })) })
        : Type.Object({ title, brief }), { minItems: 1 }),
      note: Type.Optional(Type.String({ description: withStrange
        ? "Only when you return fewer directions than asked for, or no strange direction: why"
        : "Only when you return fewer directions than asked for: why" })),
    }),
  }
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
    tools: [planTool(count)],
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
 * Turn a workspace's question into one direction per idea (decision 45). The
 * planner sees the question, the board's rows, the source and a render of
 * each row as the real files show it, and the names of every part. An idea
 * can reuse parts, change them or add new ones.
 *
 * @param {{
 *   engine: Engine,
 *   question: string,
 *   count: number,
 *   rows: readonly import("../types").StateRef[],
 *   device: string,
 *   context: Content[],
 *   images?: readonly import("./images.js").AttachedImage[],
 *   skills?: import("./skills.js").SkillCatalog,
 *   signal?: AbortSignal,
 * }} input
 *   `context` holds the rows' sources and renders, and the list of parts.
 * @returns {Promise<TakePlan & { name?: string }>}
 */
export async function planIdeas({ engine, question, count, rows, device, context, images = [], skills, signal }) {
  const { models, model, reasoning } = engine
  const listed = rows.map(row => `- ${row.part}, state "${row.state}"`).join("\n")
  const message = await models.completeSimple(model, {
    systemPrompt: `${ideasSystemPrompt(count)}${skills ? plannerSkillNote(skills) : ""}`,
    tools: [planTool(count, true)],
    messages: [{
      role: "user",
      timestamp: Date.now(),
      content: [
        { type: "text", text: `The user's question: ${question}\n\nPropose up to ${count} ideas. The board compares them on ${device}, on these rows:\n${listed}` },
        ...context,
        ...imageContent(images, "this prompt"),
      ],
    }],
  }, {
    ...(reasoning === "off" ? {} : { reasoning }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(`The planner failed: ${message.errorMessage ?? message.stopReason}`)
  }
  const call = message.content.find(block => block.type === "toolCall" && block.name === IDEAS_TOOL)
  if (call === undefined || call.type !== "toolCall") throw new Error("The planner did not propose any ideas.")
  const plan = cleanPlan(call.arguments, count)
  const raw = /** @type {{ name?: unknown }} */ (call.arguments ?? {}).name
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, TITLE_LIMIT) : ""
  return name === "" ? plan : { name, ...plan }
}

/**
 * Keep the planner's answer inside the contract: 1 to `count` directions,
 * each with a title and a brief, no two with the same title. At most one
 * direction is strange, and none when `count` is below `STRANGE_FROM`. The
 * note stays only when it explains something missing: fewer directions, or
 * no strange direction when one was asked for.
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
  let strangeLeft = count >= STRANGE_FROM
  for (const item of Array.isArray(input.directions) ? input.directions : []) {
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, TITLE_LIMIT) : ""
    const brief = typeof item?.brief === "string" ? item.brief.trim().slice(0, BRIEF_LIMIT) : ""
    if (title === "" || brief === "" || seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    const strange = strangeLeft && item.strange === true
    if (strange) strangeLeft = false
    directions.push(strange ? { title, brief, strange: true } : { title, brief })
    if (directions.length === count) break
  }
  if (directions.length === 0) throw new Error("The planner proposed no usable directions.")
  const missing = directions.length < count || strangeLeft
  const note = typeof input.note === "string" && input.note.trim() !== "" && missing ? input.note.trim() : undefined
  return note === undefined ? { directions } : { directions, note }
}

const strangeRule = `
Make one of the directions the strange direction, and set strange to true on it. The other directions are the answers a careful designer would expect. The strange direction is the answer they would not expect: it breaks the part's current pattern on purpose, for example a different structure, a different way to show the data, or a different interaction. It is still a real answer to the request that works on the device, never a joke or a strawman, and it keeps the rules above. It uses one of the takes, not an extra one. Leave it out only when the request has one sensible answer, and then say why in note.
`

/** @param {number} count */
function ideasSystemPrompt(count) {
  return `You plan ideas inside Caliper, a tool that shows a React project's UI parts at the true size of the devices it targets. The user asks a question about the product. An idea is one answer to it. An AI agent makes each idea on its own, in parallel, in its own copy of the project's files. The user compares the ideas on a board: each row is a state of the product, shown by the real files and by every idea.

An idea can reuse the parts the project has, change them, add new parts, or do all three. Choose what the question needs. Nothing an idea changes reaches the product until the user promotes it, so an idea may try something the product does not do yet.

Propose up to ${count} directions, one per idea. A good set of directions:
- Each direction is a real, reasonable answer to the question, not a strawman.
- They differ in approach, not only in degree: a different place in the product, a different structure, a different interaction or trade-off.
- Each brief says concretely what that idea changes or adds (which component, CSS, part or example data) and how it differs from the others. Each agent sees only its own brief and the titles of the others.
- An idea is judged on the board's rows. Say which rows it changes, if not all.

Also name the question in two to five words, for the list of workspaces.

Return fewer directions when the question has only one or two sensible answers. Never invent a direction only to fill the count. When you return fewer, say why in one sentence in note.
${count >= STRANGE_FROM ? strangeRule.replaceAll("the part's current pattern", "the product's current pattern") : ""}
You see the question, the source of each row's part, how each row renders now, and the names of the project's parts. You cannot read other files; the agents will. Call ${IDEAS_TOOL} exactly once, and write nothing else.`
}

/** @param {number} count */
function systemPrompt(count) {
  return `You plan takes inside Caliper, a tool that shows a React project's UI parts at the true size of the devices it targets. A take is one proposed version of a part; an AI agent makes each take on its own, in parallel, and the user compares them side by side.

The user asked for ${count} takes of one request. Your job is to make them different in a way that is useful to compare. Propose up to ${count} directions, one per take.

A good set of directions:
- Each direction is a real, reasonable answer to the request, not a strawman.
- They differ in approach, not only in degree: different structure, different source of data, different emphasis, different trade-off. "Red" and "darker red" are one direction.
- Each brief says concretely what that take changes (which component, CSS or example data) and how it differs from the others. Each agent sees only its own brief and the titles of the others.
- When the preview differs from the editing subject, preserve the preview's real composition and fixture data flow. The scenario is where changes are judged, not permission to change unrelated components.

Return fewer directions when the request has only one or two sensible answers, for example a precise fix or a narrow data change. Never invent a direction only to fill the count. When you return fewer, say why in one sentence in note.
${count >= STRANGE_FROM ? strangeRule : ""}
You see the part's source and a screenshot. You cannot read other files; the agents will. Call ${PLAN_TOOL} exactly once, and write nothing else.`
}
