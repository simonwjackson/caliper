// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { discoverSkills, plannerSkillNote, skillPrompt, skillSession, splitFrontMatter } from "../src/agent/skills.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { planDirections } from "../src/agent/planner.js"
import { createTakeStore } from "../src/takes/store.js"

/**
 * A home folder and a Git repository with a project inside it, in a temp folder.
 *
 * @param {Record<string, string>} files paths under the temp folder: `home/…`, `repo/…`
 * @param {(paths: { home: string, repo: string, root: string }) => Promise<void> | void} run
 */
async function inTree(files, run) {
  const base = mkdtempSync(join(tmpdir(), "caliper-skills-"))
  try {
    const home = join(base, "home")
    const repo = join(base, "repo")
    const root = join(repo, "apps/web")
    for (const dir of [home, join(repo, ".git"), root]) mkdirSync(dir, { recursive: true })
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(base, file)), { recursive: true })
      writeFileSync(join(base, file), content)
    }
    await run({ home, repo, root })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

/** @param {string} name @param {string} description @param {string} [body] @param {string} [extra] */
const skill = (name, description, body = `# ${name}\n\nDo the ${name} thing.`, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

describe("finding skills", () => {
  test("looks in the project, its parents up to the Git root, vite.config folders and ~/.agents/skills, first found wins", async () => {
    await inTree({
      "repo/apps/web/.agents/skills/layout/SKILL.md": skill("layout", "Project layout rules."),
      "repo/.agents/skills/layout/SKILL.md": skill("layout", "Repository layout rules."),
      "repo/.agents/skills/copy/SKILL.md": skill("copy", "Repository writing rules."),
      "home/.pi/agent/skills/intrinsic/SKILL.md": skill("intrinsic", "Layout from container size."),
      "home/.pi/agent/skills/copy/SKILL.md": skill("copy", "Pi writing rules."),
      "home/single/SKILL.md": skill("single", "One skill's own folder."),
      "home/.agents/skills/review/SKILL.md": skill("review", "User review rules."),
    }, ({ home, root }) => {
      const catalog = discoverSkills({ root, home, option: ["~/.pi/agent/skills", join(home, "single")] })
      expect(catalog.skills.map(found => [found.name, found.scope, found.description])).toEqual([
        ["layout", "project", "Project layout rules."],
        ["copy", "project", "Repository writing rules."],
        ["intrinsic", "configured", "Layout from container size."],
        ["single", "configured", "One skill's own folder."],
        ["review", "user", "User review rules."],
      ])
      expect(catalog.skills[0]?.location).toBe(".agents/skills/layout/SKILL.md")
      expect(catalog.skills[2]?.location).toBe("~/.pi/agent/skills/intrinsic/SKILL.md")
      expect(catalog.problems).toHaveLength(2)
      expect(catalog.problems.join("\n")).toContain('Skill "layout"')
      expect(catalog.problems.join("\n")).toContain('Skill "copy" in ~/.pi/agent/skills/copy/SKILL.md is hidden')
    })
  })

  test("stops at the project root when no parent is a Git repository", async () => {
    await inTree({ "outside/.agents/skills/far/SKILL.md": skill("far", "Far away.") }, ({ home }) => {
      const base = dirname(home)
      const root = join(base, "outside/project")
      mkdirSync(root, { recursive: true })
      expect(discoverSkills({ root, home, option: undefined }).skills).toEqual([])
    })
  })

  test("reports a missing configured folder and a bad option, and false turns skills off", async () => {
    await inTree({ "home/.agents/skills/review/SKILL.md": skill("review", "User review rules.") }, ({ home, root }) => {
      expect(discoverSkills({ root, home, option: ["./nowhere"] }).problems).toEqual(["Skill folder nowhere does not exist."])
      expect(discoverSkills({ root, home, option: "~/.pi" }).problems[0]).toContain("agent.skills must be false, a list of folders")
      expect(discoverSkills({ root, home, option: { only: ["review"] } }).problems[0]).toContain("{ folders, include, exclude }")
      expect(discoverSkills({ root, home, option: { include: "review" } }).problems[0]).toContain("{ folders, include, exclude }")
      expect(discoverSkills({ root, home, option: false })).toEqual({ skills: [], problems: [] })
    })
  })

  test("include keeps only the named skills, exclude drops them, and an unknown name is reported", async () => {
    await inTree({
      "repo/apps/web/.agents/skills/layout/SKILL.md": skill("layout", "Project layout rules."),
      "home/extra/copy/SKILL.md": skill("copy", "Writing rules."),
      "home/.agents/skills/tdd/SKILL.md": skill("tdd", "Test first."),
      "home/.agents/skills/intrinsic-design/SKILL.md": skill("intrinsic-design", "Layout from container size."),
    }, async ({ home, root }) => {
      /** @param {unknown} option */
      const names = option => discoverSkills({ root, home, option }).skills.map(found => found.name)
      expect(names(undefined)).toEqual(["layout", "intrinsic-design", "tdd"])
      expect(names({ folders: ["~/extra"] })).toEqual(["layout", "copy", "intrinsic-design", "tdd"])
      expect(names({ include: ["intrinsic-design", "layout"] })).toEqual(["layout", "intrinsic-design"])
      expect(names({ exclude: ["tdd"] })).toEqual(["layout", "intrinsic-design"])
      expect(names({ include: ["layout", "tdd"], exclude: ["tdd"] })).toEqual(["layout"])
      const typo = discoverSkills({ root, home, option: { include: ["intrinsic"], exclude: ["tdd"] } })
      expect(typo.skills).toEqual([])
      expect(typo.problems).toEqual(['agent.skills.include names "intrinsic", which Caliper did not find.'])
      // A filtered skill cannot be named with /name either.
      expect(await skillSession(discoverSkills({ root, home, option: { exclude: ["tdd"] } })).mentioned("/tdd")).toEqual([])
    })
  })

  test("loads leniently: warns on a name that differs from its folder, skips a skill without a description", async () => {
    await inTree({
      "repo/apps/web/.agents/skills/tidy/SKILL.md": skill("Tidy-Up", "Tidy things."),
      "repo/apps/web/.agents/skills/empty/SKILL.md": "---\nname: empty\n---\nBody\n",
      "repo/apps/web/.agents/skills/plain/SKILL.md": "No front matter here.\n",
      "repo/apps/web/.agents/skills/unnamed/SKILL.md": "---\ndescription: No name given.\n---\nBody\n",
    }, ({ home, root }) => {
      const catalog = discoverSkills({ root, home, option: undefined })
      expect(catalog.skills.map(found => found.name)).toEqual(["Tidy-Up", "unnamed"])
      expect(catalog.problems).toEqual([
        ".agents/skills/empty/SKILL.md has no description, so Caliper skipped it.",
        ".agents/skills/plain/SKILL.md has no readable front matter, so Caliper skipped it.",
        '.agents/skills/tidy/SKILL.md is named "Tidy-Up" but its folder is "tidy".',
        '.agents/skills/unnamed/SKILL.md has no name. Caliper uses the folder name "unnamed".',
      ])
    })
  })

  test("reads block descriptions, and descriptions with a colon that strict YAML refuses", () => {
    expect(splitFrontMatter("---\nname: a\ndescription: |\n  Two\n  lines.\n---\nBody").data?.description).toBe("Two\nlines.\n")
    expect(splitFrontMatter("---\nname: a\ndescription: Use this when: the user asks\n---\nBody")).toEqual({
      data: { name: "a", description: "Use this when: the user asks" },
      body: "Body",
    })
  })
})

describe("telling the model", () => {
  test("lists no catalog, and no tools, when there are no skills", () => {
    const empty = { skills: [], problems: [] }
    expect(skillPrompt(empty)).toBe("")
    expect(plannerSkillNote(empty)).toBe("")
    expect(skillSession(empty).tools).toEqual([])
  })

  test("hides a skill that disables model invocation, but a prompt can still name it", async () => {
    await inTree({
      "repo/apps/web/.agents/skills/manual/SKILL.md": skill("manual", "Only on request.", "# Manual\n\nSteps.", "disable-model-invocation: true\n"),
      "repo/apps/web/.agents/skills/auto/SKILL.md": skill("auto", "Use <always> & often."),
    }, async ({ home, root }) => {
      const catalog = discoverSkills({ root, home, option: undefined })
      const prompt = skillPrompt(catalog)
      expect(prompt).toContain("<name>auto</name>")
      expect(prompt).toContain("Use &lt;always&gt; &amp; often.")
      expect(prompt).not.toContain("manual")
      const session = skillSession(catalog)
      expect(session.tools.map(tool => tool.name)).toEqual(["activate_skill", "read_skill_file"])
      const [named] = await session.mentioned("Fix the spacing /manual please, see src/ui/auto.css")
      expect(named?.name).toBe("manual")
      expect(named?.text).toContain("# Manual\n\nSteps.")
      expect(await session.mentioned("again /manual")).toEqual([])
    })
  })
})

describe("a take agent with skills", () => {
  const ask = { part: "src/Chip.part.tsx", state: "default", device: "iphone-16" }

  test("sees the catalog, loads a skill once, reads its files, and cannot read outside them", async () => {
    await inTree({
      "repo/apps/web/src/Chip.part.tsx": "export default function Part() { return null }\n",
      "repo/apps/web/.agents/skills/intrinsic/SKILL.md": skill("intrinsic", "Layout as a function of container size.", "# Intrinsic\n\nSee [the example](EXAMPLE.md)."),
      "repo/apps/web/.agents/skills/intrinsic/EXAMPLE.md": "A worked case.\n",
      "repo/apps/web/secret.txt": "not for skills\n",
    }, async ({ home, root }) => {
      const faux = fauxProvider({ models: [{ id: "scripted", reasoning: true, input: ["text", "image"] }] })
      const models = createModels()
      models.setProvider(faux.provider)
      /** @type {any[]} */
      const seen = []
      /** @param {any} message */
      const see = message => (/** @type {any} */ context) => { seen.push(context); return message }
      faux.setResponses([
        see(fauxAssistantMessage([fauxToolCall("activate_skill", { name: "intrinsic" })], { stopReason: "toolUse" })),
        see(fauxAssistantMessage([fauxToolCall("activate_skill", { name: "intrinsic" })], { stopReason: "toolUse" })),
        see(fauxAssistantMessage([fauxToolCall("read_skill_file", { name: "intrinsic", path: "EXAMPLE.md" })], { stopReason: "toolUse" })),
        see(fauxAssistantMessage([fauxToolCall("read_skill_file", { name: "intrinsic", path: "../../../secret.txt" })], { stopReason: "toolUse" })),
        see(fauxAssistantMessage([fauxText("Done.")])),
      ])
      let settle = () => {}
      const agents = createTakeAgents({
        store: createTakeStore(root),
        engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
        renderFor: () => async () => { throw new Error("no renders here") },
        onChange: () => settle(),
        skills: () => discoverSkills({ root, home, option: undefined }),
      })
      const take = await agents.start({ ...ask, prompt: "Give it room" })
      for (;;) {
        const changed = new Promise(resolve => { settle = () => resolve(undefined) })
        if ((await agents.views()).find(view => view.take === take)?.run._tag !== "Running") break
        await changed
      }

      expect(JSON.stringify(seen[0].messages.find((/** @type {any} */ message) => message.role === "system"))).toContain("<name>intrinsic</name>")
      expect(JSON.stringify(seen[0])).toContain("read_skill_file")
      /** @param {number} turn */
      const result = turn => seen[turn].messages.at(-1).content[0].text
      expect(result(1)).toStartWith('<skill_content name="intrinsic">\n# Intrinsic')
      expect(result(1)).not.toContain("description:")
      expect(result(1)).toContain("<file>EXAMPLE.md</file>")
      expect(result(2)).toContain("already loaded")
      expect(result(3)).toBe("A worked case.\n")
      expect(result(4)).toContain("outside the skill's folder")
      const log = (await agents.views())[0]?.log.filter(entry => entry._tag === "Tool") ?? []
      expect(log.map(entry => entry._tag === "Tool" && [entry.name, entry.subject, entry.outcome, entry.detail])).toEqual([
        ["activate_skill", "intrinsic", "Done", "Loaded its instructions."],
        ["activate_skill", "intrinsic", "Done", "Already loaded."],
        ["read_skill_file", "intrinsic: EXAMPLE.md", "Done", "A worked case."],
        ["read_skill_file", "intrinsic: ../../../secret.txt", "Failed", expect.stringContaining("outside the skill's folder")],
      ])
    })
  })

  test("loads a skill the prompt names as /name into the first message", async () => {
    await inTree({
      "repo/apps/web/src/Chip.part.tsx": "export default function Part() { return null }\n",
      "repo/apps/web/.agents/skills/intrinsic/SKILL.md": skill("intrinsic", "Layout rules.", "# Intrinsic\n\nMeasure the container."),
    }, async ({ home, root }) => {
      const faux = fauxProvider({ models: [{ id: "scripted", reasoning: true, input: ["text", "image"] }] })
      const models = createModels()
      models.setProvider(faux.provider)
      /** @type {any} */
      let first = null
      faux.setResponses([context => { first = context; return fauxAssistantMessage([fauxText("Done.")]) }])
      let settle = () => {}
      const agents = createTakeAgents({
        store: createTakeStore(root),
        engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
        renderFor: () => async () => { throw new Error("no renders here") },
        onChange: () => settle(),
        skills: () => discoverSkills({ root, home, option: undefined }),
      })
      const take = await agents.start({ ...ask, prompt: "Use /intrinsic for the gap" })
      for (;;) {
        const changed = new Promise(resolve => { settle = () => resolve(undefined) })
        if ((await agents.views()).find(view => view.take === take)?.run._tag !== "Running") break
        await changed
      }
      const text = first.messages.find((/** @type {any} */ message) => message.role === "user").content[0].text
      expect(text).toStartWith('<skill_content name="intrinsic">\n# Intrinsic\n\nMeasure the container.')
      expect(text).toContain("Use /intrinsic for the gap")
      expect((await agents.views())[0]?.log[1]).toMatchObject({ _tag: "Tool", name: "activate_skill", subject: "intrinsic", detail: "Loaded because the prompt names /intrinsic." })
    })
  })

  test("the planner sees skill names, so a brief can name one", async () => {
    const faux = fauxProvider({ models: [{ id: "planner", reasoning: true, input: ["text"] }] })
    const models = createModels()
    models.setProvider(faux.provider)
    /** @type {any} */
    let system = null
    faux.setResponses([context => {
      system = JSON.stringify(context.messages.find((/** @type {any} */ message) => message.role === "system"))
      return fauxAssistantMessage([fauxToolCall("propose_directions", { directions: [{ title: "A", brief: "Use intrinsic." }] })], { stopReason: "toolUse" })
    }])
    const catalog = { skills: [{ name: "intrinsic", description: "Layout\nrules.", scope: /** @type {const} */ ("project"), location: "x", file: "x", dir: "x", modelInvocable: true }], problems: [] }
    await planDirections({ engine: { models, model: faux.getModel(), reasoning: "medium" }, prompt: "p", count: 2, part: "a", state: "default", device: "iphone-16", context: [], skills: catalog })
    expect(system).toContain("- intrinsic: Layout rules.")
  })
})
