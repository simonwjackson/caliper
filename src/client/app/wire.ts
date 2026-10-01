import { Type } from "typebox"
import type { Static, TSchema } from "typebox"
import { Check } from "typebox/value"
import { StateRefSchema } from "../../scenario-contract.js"
import { ExpectationsSchema } from "../../expectation-contract.js"
import { CheckDeclarationSchema } from "../../authored/contract.js"
import { ChecksViewSchema } from "../../checks/contract.js"
import { integrationProposalSchema } from "../../takes/integration-contract.js"
import { KnobHintsSchema } from "../../knobs/contract.js"
import { TakeIdentitySchema } from "../../takes/marks-contract.js"
import { AcceptRecordSchema } from "../../takes/accepted-contract.js"
import type { Project, TakesSnapshot } from "../../types"

const text = Type.String()
const strings = Type.Array(text)
const tag = <T extends string | boolean>(value: T) => Type.Literal(value)
const Site = Type.Object({ file: text, line: Type.Integer({ minimum: 1 }) })
function derivation<T extends TSchema>(value: T) {
  return Type.Union([
    Type.Object({ _tag: tag("Derived"), value, source: Site, via: text }),
    Type.Object({ _tag: tag("Overridden"), value, option: Type.Union([tag("entry"), tag("wrap"), tag("css")]) }),
    Type.Object({ _tag: tag("Failed"), reason: text, hint: text }),
  ])
}
export const ProjectSchema = Type.Object({
  name: text,
  parts: Type.Array(Type.Object({
    file: text, name: text, note: Type.Optional(text),
    layer: Type.Optional(Type.Union([tag("page"), tag("template"), tag("organism"), tag("molecule"), tag("atom")])),
    layerSource: Type.Optional(Site),
    states: Type.Array(Type.Object({ export: text, label: text, line: Type.Optional(Type.Integer()) })),
    composition: Type.Optional(Type.Record(text, Type.Array(StateRefSchema))),
    compositionProblems: Type.Optional(strings),
    expectations: Type.Optional(ExpectationsSchema), expectationProblems: Type.Optional(strings),
    authoredChecks: Type.Optional(Type.Record(text, Type.Array(CheckDeclarationSchema))), authoredCheckProblems: Type.Optional(strings),
  })),
  entry: derivation(Type.Object({ file: text })),
  css: derivation(Type.Object({
    stylesheets: Type.Array(Type.Object({ file: text, importedAt: Type.Optional(Site) })),
    unresolved: Type.Array(Type.Object({ specifier: text, at: Site })),
  })),
  wrapper: derivation(Type.Object({ elements: Type.Array(Type.Object({ tag: text, className: text })), renderedAt: Type.Optional(Site) })),
})
export const DirectionSchema = Type.Object({ title: text, brief: text, strange: Type.Optional(tag(true)) })
export const PlanSchema = Type.Object({ directions: Type.Array(DirectionSchema, { maxItems: 4 }), note: Type.Optional(text) })
export const TakesSchema = Type.Object({
  agent: Type.Union([
    Type.Object({ _tag: tag("Off"), hint: text }),
    Type.Object({ _tag: tag("Failed"), reason: text, hint: text }),
    Type.Object({ _tag: tag("Ready"), model: text, baseUrl: text,
      reasoning: Type.Union([tag("off"), tag("minimal"), tag("low"), tag("medium"), tag("high"), tag("xhigh"), tag("max")]),
      api: Type.Union([tag("chat-completions"), tag("responses"), tag("anthropic"), tag("google")]), baseUrlFrom: text, keyFrom: text }),
  ]),
  skills: Type.Object({ skills: Type.Array(Type.Object({ name: text, description: text, scope: Type.Union([tag("project"), tag("configured"), tag("user")]), location: text })), problems: strings }),
  takes: Type.Array(Type.Object({
    take: Type.String({ pattern: "^[1-9][0-9]*$" }), part: text, state: text, context: Type.Optional(StateRefSchema), device: text, created: Type.Number({ minimum: 0, maximum: 8.64e15 }),
    name: Type.Optional(text), nameIssue: Type.Optional(text), direction: Type.Optional(DirectionSchema),
    parent: Type.Optional(TakeIdentitySchema), chain: Type.Optional(TakeIdentitySchema), lineage: Type.Optional(Type.Array(TakeIdentitySchema)),
    integration: Type.Optional(Type.Union([
      Type.Object({ _tag: tag("Preparing"), sourceTake: text }),
      Type.Object({ _tag: tag("Review"), sourceTake: text, proposal: integrationProposalSchema }),
    ])),
    run: Type.Union([Type.Object({ _tag: tag("Idle") }), Type.Object({ _tag: tag("Running") }), Type.Object({ _tag: tag("Failed"), reason: text })]),
    files: strings,
    images: Type.Array(Type.Object({ file: text, name: text, mimeType: Type.Union([tag("image/png"), tag("image/jpeg"), tag("image/webp"), tag("image/gif")]) })),
    log: Type.Array(Type.Union([
      Type.Object({ _tag: tag("User"), text, images: Type.Optional(strings) }),
      Type.Object({ _tag: tag("Assistant"), text }), Type.Object({ _tag: tag("Edit"), file: text }),
      Type.Object({ _tag: tag("Tool"), id: text, name: text, subject: text, outcome: Type.Union([tag("Running"), tag("Done"), tag("Failed")]), detail: text }),
    ])),
  })),
  accepted: Type.Array(AcceptRecordSchema),
})
export const CodeChangeSchema = Type.Object({ file: text, take: Type.Union([text, Type.Null()]) })
export const FrameReportSchema = Type.Object({
  source: tag("caliper-frame"), part: text, partState: text, take: Type.Union([text, Type.Null()]),
  state: Type.Union([tag("Loading"), tag("Rendered"), tag("Empty"), tag("Failed")]),
  problems: Type.Array(Type.Object({ kind: Type.Union([tag("error"), tag("warning")]), title: text, detail: text })),
})
export type FrameReport = Static<typeof FrameReportSchema>
export function parseWire<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Check(schema, value)) throw new Error("Caliper received an invalid server snapshot.")
  return value
}
export function parseProject(value: unknown): Project { return parseWire(ProjectSchema, value) }
export function parseTakes(value: unknown): TakesSnapshot { return parseWire(TakesSchema, value) }
export { ChecksViewSchema }

const CodeFilesSchema = Type.Object({ files: Type.Array(Type.Object({ file: text, depth: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]), changed: Type.Boolean() })) })
const CodeDocumentSchema = Type.Object({ file: text, content: text, original: Type.Optional(Type.Union([text, Type.Null()])) })
const ReviewSchema = Type.Object({ revision: text, proposal: integrationProposalSchema, files: Type.Array(Type.Object({ path: text, before: Type.Union([text, Type.Null()]), after: text })), checks: Type.Union([Type.Object({ _tag: tag("NotRun") }), Type.Object({ _tag: tag("Passed"), summary: text }), Type.Object({ _tag: tag("Failed"), reason: text })]) })
const LocatedSchema = Type.Union([Type.Object({ _tag: tag("Refused"), reason: text }), Type.Object({ _tag: tag("Located"), file: text, start: Type.Integer(), end: Type.Integer(), line: Type.Integer(), value: text, version: text, hints: KnobHintsSchema, note: text, problems: strings })])
const LocateSchema = Type.Object({ results: Type.Array(LocatedSchema), configured: Type.Record(text, KnobHintsSchema), problems: strings })
const KnobResultSchema = Type.Union([Type.Object({ _tag: tag("Conflict"), reason: text }), Type.Object({ _tag: tag("Written"), file: text, version: text }), Type.Object({ _tag: tag("Promoted"), files: strings, name: text })])
/** Wire assertions run before a response reaches any region controller. Existing schemas retain authority. */
export function validateResponse(path: string, value: unknown, writing: boolean) {
  const route = path.replace(/^\//, "").split("?")[0]
  const schema = route === "project.json" ? ProjectSchema : route === "takes.json" ? TakesSchema : route === "code/files" ? CodeFilesSchema : route === "code/file" && !writing ? CodeDocumentSchema
    : route === "checks" || route?.startsWith("checks/") ? ChecksViewSchema : route === "takes/plan" ? PlanSchema
    : route?.match(/^takes\/[^/]+\/(review|check)$/) ? ReviewSchema
    : route === "knobs/locate" ? LocateSchema : route === "knobs/write" || route === "knobs/promote" ? KnobResultSchema : null
  if (schema) parseWire(schema, value)
}
