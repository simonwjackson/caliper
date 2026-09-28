// @ts-check
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import { parse as parseYaml } from "yaml"
import { Type } from "typebox"

/**
 * Agent Skills (https://agentskills.io) for the take agent. A skill is a
 * folder with a SKILL.md: YAML front matter with `name` and `description`,
 * then Markdown instructions. The agent sees only each skill's name and
 * description until it activates one, so unused skills cost few tokens.
 *
 * Where Caliper looks, first found wins on a name collision:
 *   1. `.agents/skills/` in the project root, then in each parent folder up
 *      to the Git root (for monorepos)
 *   2. each folder in `agent.skills` in vite.config, in order
 *   3. `~/.agents/skills/`
 *
 * @typedef {import("../types").SkillSummary} SkillSummary
 * @typedef {import("../types").SkillsStatus} SkillsStatus
 * @typedef {SkillSummary & { readonly file: string, readonly dir: string, readonly modelInvocable: boolean }} Skill
 *   `file` is the absolute path of SKILL.md; `dir` is its folder.
 * @typedef {{ readonly skills: readonly Skill[], readonly problems: readonly string[] }} SkillCatalog
 * @typedef {import("@earendil-works/pi-agent-core").AgentTool} AgentTool
 */

export const SKILLS_DIR = ".agents/skills"
/** The most characters read_skill_file returns. */
const READ_LIMIT = 200_000
/** The most files activate_skill lists from a skill's folder. */
const RESOURCE_LIMIT = 50
const SKIP = new Set([".git", "node_modules"])
/** The spec's limits. Caliper warns past them and still loads the skill. */
const NAME_LIMIT = 64
const DESCRIPTION_LIMIT = 1024

/**
 * Find every skill the take agent may use. Reads the file system; never
 * throws. Problems are for the user, not the model.
 *
 * @param {{ root: string, home: string, option: unknown }} input
 *   `option` is `agent.skills` from vite.config: undefined, false, or folders.
 * @returns {SkillCatalog}
 */
export function discoverSkills({ root, home, option }) {
  if (option === false) return { skills: [], problems: [] }
  /** @type {string[]} */
  const problems = []
  /** @type {Array<{ dir: string, scope: SkillSummary["scope"], required: boolean }>} */
  const sources = [
    ...projectFolders(root).map(dir => ({ dir: join(dir, SKILLS_DIR), scope: /** @type {const} */ ("project"), required: false })),
    ...configured(option, root, home, problems).map(dir => ({ dir, scope: /** @type {const} */ ("configured"), required: true })),
    { dir: join(home, SKILLS_DIR), scope: "user", required: false },
  ]
  /** @type {Map<string, Skill>} */
  const found = new Map()
  const seenDirs = new Set()
  for (const source of sources) {
    const real = realOrNull(source.dir)
    if (real === null) {
      if (source.required) problems.push(`Skill folder ${shown(source.dir, root, home)} does not exist.`)
      continue
    }
    if (seenDirs.has(real)) continue
    seenDirs.add(real)
    for (const file of skillFiles(real)) {
      const skill = readSkill(file, source.scope, root, home, problems)
      if (skill === null) continue
      const earlier = found.get(skill.name)
      if (earlier) {
        problems.push(`Skill "${skill.name}" in ${skill.location} is hidden by the one in ${earlier.location}.`)
        continue
      }
      found.set(skill.name, skill)
    }
  }
  return { skills: [...found.values()], problems }
}

/** The catalog as the chrome shows it: no absolute paths beyond `location`. @param {SkillCatalog} catalog @returns {SkillsStatus} */
export function skillsStatus(catalog) {
  return {
    skills: catalog.skills.map(({ name, description, scope, location }) => ({ name, description, scope, location })),
    problems: catalog.problems,
  }
}

/**
 * The system prompt section that lists the skills. Empty when there are none,
 * so the model never sees an empty catalog.
 *
 * @param {SkillCatalog} catalog
 */
export function skillPrompt(catalog) {
  const listed = catalog.skills.filter(skill => skill.modelInvocable)
  if (listed.length === 0) return ""
  const entries = listed.map(skill => `<skill>\n<name>${xml(skill.name)}</name>\n<description>${xml(skill.description)}</description>\n</skill>`).join("\n")
  return `

Skills: these skills give specialized instructions for specific tasks. When the request matches a skill's description, call activate_skill with its name to load its instructions before you change anything. Load a file that a skill refers to with read_skill_file. Skills written for other tools can mention tools you do not have, such as a shell. Follow what your tools allow, and say what you could not do.

<available_skills>
${entries}
</available_skills>`
}

/**
 * The planner's view of the skills: names and descriptions, so a brief can
 * name the skill its take should use. Empty when there are none.
 *
 * @param {SkillCatalog} catalog
 */
export function plannerSkillNote(catalog) {
  const listed = catalog.skills.filter(skill => skill.modelInvocable)
  if (listed.length === 0) return ""
  return `\n\nThe take agents can load these skills:\n${listed.map(skill => `- ${skill.name}: ${oneLine(skill.description)}`).join("\n")}\nWhen a skill fits a direction, name it in that direction's brief.`
}

/**
 * One take agent's use of the skills: its tools, and the skills the user
 * names with `/name` in a prompt. It remembers what it has loaded, so the
 * conversation never holds the same instructions twice.
 *
 * @param {SkillCatalog} catalog
 * @returns {{ tools: AgentTool[], mentioned: (prompt: string) => Array<{ name: string, text: string }> }}
 */
export function skillSession(catalog) {
  /** @type {Map<string, Skill>} */
  const byName = new Map(catalog.skills.map(skill => [skill.name, skill]))
  const loaded = new Set()
  /** @param {string} value */
  const text = value => ({ type: /** @type {const} */ ("text"), text: value })

  /** @param {Skill} skill */
  const activate = skill => {
    if (loaded.has(skill.name)) return `The skill "${skill.name}" is already loaded earlier in this conversation. Follow those instructions.`
    loaded.add(skill.name)
    return skillContent(skill)
  }

  /** @param {string} prompt */
  const mentioned = prompt => {
    const names = [...prompt.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]*)(?=$|[\s.,;:!?)])/g)].map(match => /** @type {string} */ (match[1]))
    return [...new Set(names)].flatMap(name => {
      const skill = byName.get(name)
      if (skill === undefined || loaded.has(name)) return []
      return [{ name, text: activate(skill) }]
    })
  }

  const invocable = catalog.skills.filter(skill => skill.modelInvocable).map(skill => skill.name)
  if (invocable.length === 0) return { tools: [], mentioned }
  const names = Type.Union(invocable.map(name => Type.Literal(name)), { description: "The skill's name from the list of available skills" })

  /** @type {AgentTool} */
  const activateTool = {
    name: "activate_skill",
    label: "Skill",
    description: "Load a skill's full instructions. Call it when the request matches the skill's description, before you change anything.",
    parameters: Type.Object({ name: names }),
    execute: async (_id, params) => {
      const { name } = /** @type {{ name: string }} */ (params)
      const skill = byName.get(name)
      if (skill === undefined) throw new Error(`There is no skill named "${name}".`)
      return { content: [text(activate(skill))], details: { name } }
    },
  }

  /** @type {AgentTool} */
  const readTool = {
    name: "read_skill_file",
    label: "Skill file",
    description: "Read a file inside a skill's folder, for example a reference that its instructions name. The path is relative to the skill's folder.",
    parameters: Type.Object({
      name: names,
      path: Type.String({ description: "Path relative to the skill's folder, for example references/EXAMPLE.md" }),
    }),
    execute: async (_id, params) => {
      const { name, path } = /** @type {{ name: string, path: string }} */ (params)
      const skill = byName.get(name)
      if (skill === undefined) throw new Error(`There is no skill named "${name}".`)
      const content = readInside(skill.dir, path)
      const clipped = content.length > READ_LIMIT ? `${content.slice(0, READ_LIMIT)}\n[... clipped at ${READ_LIMIT} characters]` : content
      return { content: [text(clipped)], details: { name, path } }
    },
  }

  return { tools: [activateTool, readTool], mentioned }
}

/**
 * A skill's instructions as the model receives them: the body without front
 * matter, wrapped so the model can tell it from the rest of the conversation,
 * with its folder's files listed but not read. Reads SKILL.md again, so an
 * edit since discovery takes effect.
 *
 * @param {Skill} skill
 */
function skillContent(skill) {
  const body = splitFrontMatter(readFileSync(skill.file, "utf8")).body
  const files = resources(skill.dir)
  const listing = files.length === 0 ? "" : `\n\n<skill_resources>\n${files.map(file => `<file>${xml(file)}</file>`).join("\n")}${files.length === RESOURCE_LIMIT ? "\n<!-- the list stops here; there can be more files -->" : ""}\n</skill_resources>`
  return `<skill_content name="${xml(skill.name)}">\n${body}\n\nPaths in this skill are relative to its folder. Read them with read_skill_file.${listing}\n</skill_content>`
}

/**
 * The project root and its parents up to the Git root. Only the root when no
 * parent holds `.git`, so a project outside Git never reads unrelated folders.
 *
 * @param {string} root
 */
function projectFolders(root) {
  const chain = [root]
  for (let dir = root; ; ) {
    if (existsSync(join(dir, ".git"))) return chain
    const parent = dirname(dir)
    if (parent === dir) return [root]
    dir = parent
    chain.push(dir)
  }
}

/**
 * @param {unknown} option
 * @param {string} root
 * @param {string} home
 * @param {string[]} problems
 * @returns {string[]}
 */
function configured(option, root, home, problems) {
  if (option === undefined) return []
  if (!Array.isArray(option) || option.some(entry => typeof entry !== "string" || entry.trim() === "")) {
    problems.push("agent.skills must be false or a list of folders, for example [\"~/.pi/agent/skills\"].")
    return []
  }
  return option.map(entry => {
    const trimmed = entry.trim()
    if (trimmed === "~") return home
    if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2))
    return isAbsolute(trimmed) ? trimmed : resolvePath(root, trimmed)
  })
}

/**
 * SKILL.md files in a folder: the folder itself when it is one skill, else
 * each child folder that holds a SKILL.md, in name order.
 *
 * @param {string} dir
 */
function skillFiles(dir) {
  const own = join(dir, "SKILL.md")
  if (isFile(own)) return [own]
  /** @type {string[]} */
  let names
  try { names = readdirSync(dir).sort() }
  catch { return [] }
  return names
    .filter(name => !SKIP.has(name) && !name.startsWith("."))
    .map(name => join(dir, name, "SKILL.md"))
    .filter(isFile)
}

/**
 * Parse one SKILL.md leniently, as the spec's client guide advises: warn on
 * cosmetic problems, skip only a skill with no description or unreadable
 * front matter.
 *
 * @param {string} file
 * @param {SkillSummary["scope"]} scope
 * @param {string} root
 * @param {string} home
 * @param {string[]} problems
 * @returns {Skill | null}
 */
function readSkill(file, scope, root, home, problems) {
  const dir = dirname(file)
  const location = shown(file, root, home)
  /** @type {string} */
  let source
  try { source = readFileSync(file, "utf8") }
  catch { problems.push(`Cannot read ${location}.`); return null }
  const { data } = splitFrontMatter(source)
  if (data === null) {
    problems.push(`${location} has no readable front matter, so Caliper skipped it.`)
    return null
  }
  const description = typeof data.description === "string" ? data.description.trim() : ""
  if (description === "") {
    problems.push(`${location} has no description, so Caliper skipped it.`)
    return null
  }
  const folder = basename(dir)
  const declared = typeof data.name === "string" ? data.name.trim() : ""
  const name = declared || folder
  if (declared === "") problems.push(`${location} has no name. Caliper uses the folder name "${folder}".`)
  else if (declared !== folder) problems.push(`${location} is named "${declared}" but its folder is "${folder}".`)
  if (name.length > NAME_LIMIT) problems.push(`${location}: the name is longer than ${NAME_LIMIT} characters.`)
  if (description.length > DESCRIPTION_LIMIT) problems.push(`${location}: the description is longer than ${DESCRIPTION_LIMIT} characters.`)
  return { name, description, scope, location, file, dir, modelInvocable: data["disable-model-invocation"] !== true }
}

/**
 * Split SKILL.md into front matter and body. `data` is null when the front
 * matter is missing or cannot be read even after quoting plain values that
 * hold a colon, a mistake other clients' parsers accept.
 *
 * @param {string} source
 * @returns {{ data: Record<string, unknown> | null, body: string }}
 */
export function splitFrontMatter(source) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (match === null) return { data: null, body: source.trim() }
  const body = source.slice(match[0].length).trim()
  const yaml = /** @type {string} */ (match[1])
  for (const attempt of [yaml, quotePlainValues(yaml)]) {
    try {
      const data = parseYaml(attempt)
      if (data !== null && typeof data === "object" && !Array.isArray(data)) return { data: /** @type {Record<string, unknown>} */ (data), body }
    } catch { /* try the next form */ }
  }
  return { data: null, body }
}

/** @param {string} yaml */
function quotePlainValues(yaml) {
  return yaml.split(/\r?\n/).map(line => {
    const match = /^([A-Za-z0-9_-]+):[ \t]+(.+)$/.exec(line)
    if (match === null) return line
    const value = /** @type {string} */ (match[2])
    if (/^["'|>[{]/.test(value) || !value.includes(": ")) return line
    return `${match[1]}: ${JSON.stringify(value)}`
  }).join("\n")
}

/**
 * Files in a skill's folder, relative to it, breadth first, without SKILL.md.
 *
 * @param {string} dir
 */
function resources(dir) {
  /** @type {string[]} */
  const files = []
  /** @type {string[]} */
  const queue = [""]
  while (queue.length > 0 && files.length < RESOURCE_LIMIT) {
    const folder = /** @type {string} */ (queue.shift())
    /** @type {import("node:fs").Dirent[]} */
    let entries
    try { entries = readdirSync(join(dir, folder), { withFileTypes: true }) }
    catch { continue }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`
      if (entry.isDirectory()) queue.push(path)
      else if (entry.isFile() && path !== "SKILL.md" && files.length < RESOURCE_LIMIT) files.push(path)
    }
  }
  return files
}

/**
 * Read a file inside a skill's folder. Refuses a path, or a link, that leads
 * out of the folder, and `.env` files.
 *
 * @param {string} dir
 * @param {string} path
 */
function readInside(dir, path) {
  if (typeof path !== "string" || path.trim() === "" || isAbsolute(path)) throw new Error("Give a path relative to the skill's folder.")
  const target = resolvePath(dir, path)
  const real = realOrNull(target)
  if (real === null) throw new Error(`${path} does not exist in this skill.`)
  const inside = relative(realOrNull(dir) ?? dir, real)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${path} is outside the skill's folder.`)
  if (inside.split(sep).some(segment => segment.startsWith(".env"))) throw new Error("Caliper does not read .env files.")
  if (!isFile(real)) throw new Error(`${path} is not a file.`)
  return readFileSync(real, "utf8")
}

/** A path for people: relative to the project, or under `~`, else absolute. @param {string} file @param {string} root @param {string} home */
function shown(file, root, home) {
  const fromRoot = relative(root, file)
  if (!fromRoot.startsWith("..") && !isAbsolute(fromRoot)) return fromRoot
  const fromHome = relative(home, file)
  if (!fromHome.startsWith("..") && !isAbsolute(fromHome)) return `~/${fromHome}`
  return file
}

/** @param {string} path */
function realOrNull(path) {
  try { return realpathSync(path) }
  catch { return null }
}

/** @param {string} path */
function isFile(path) {
  try { return statSync(path).isFile() }
  catch { return false }
}

/** @param {string} value */
function xml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** @param {string} value */
function oneLine(value) {
  return value.replace(/\s+/g, " ").trim()
}
