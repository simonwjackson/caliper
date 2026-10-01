import { Type } from "typebox"
import { Check } from "typebox/value"
import { integrationProposalSchema } from "../../takes/integration-contract.js"
import type { CodeChange, TakeView } from "../../types"
import type { Review } from "../../takes/integration.js"
import type { Availability, IntegrationView, Notice } from "../ui/contract"

type Request = <T>(path: string, data?: object) => Promise<T>
type DiffModule = typeof import("../code-editor.js")
const enabled: Availability = { _tag: "Enabled" }
const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem)
// Review is the server's return shape, not a replacement for its write schemas.
const ReviewSchema = Type.Object({
  revision: Type.String({ minLength: 1 }), proposal: integrationProposalSchema,
  files: Type.Array(Type.Object({ path: Type.String(), before: Type.Union([Type.String(), Type.Null()]), after: Type.String() })),
  checks: Type.Union([
    Type.Object({ _tag: Type.Literal("NotRun") }),
    Type.Object({ _tag: Type.Literal("Passed"), summary: Type.String() }),
    Type.Object({ _tag: Type.Literal("Failed"), reason: Type.String() }),
  ]),
})

/** Owns exact-revision review and editor lifetimes, never take preparation or UI placement. */
export function createIntegrationController({ request, changed }: { request: Request; changed: () => void }) {
  let selected: TakeView | null = null
  let shown: Review | null = null
  let busy = false
  let attested = false
  let error = ""
  let epoch = 0
  let destroyed = false
  let editor: DiffModule | null = null
  let loading: Promise<void> | null = null
  let editorProblem = ""
  const hosts = new Map<string, HTMLDivElement>()
  const diffs = new Map<string, { element: HTMLDivElement; destroy: () => void }>()
  const publish = () => { if (!destroyed) changed() }
  const clearDiffs = () => { for (const diff of diffs.values()) diff.destroy(); diffs.clear(); hosts.clear() }
  const invalidate = () => { epoch++; busy = false; shown = null; attested = false; clearDiffs() }
  const available = () => !!selected?.integration && selected.integration._tag === "Review" && selected.run._tag !== "Running"
  const exact = (take: string, revision: string) => available() && selected?.take === take && shown?.revision === revision
  const getView = (): IntegrationView => {
    const integration = selected?.integration
    if (!integration || destroyed) return { _tag: "None" }
    if (selected?.run._tag === "Running" || integration._tag === "Preparing") return { _tag: "Preparing", sourceTake: integration.sourceTake, message: selected?.run._tag === "Running" ? "The agent is preparing the integration. Real files are unchanged." : "No proposal was submitted. Send a follow-up to finish preparation." }
    const notices: Notice[] = [...(error ? [{ kind: "error" as const, text: error }] : []), ...(editorProblem ? [{ kind: "error" as const, text: `Caliper could not load its diff view: ${editorProblem}` }] : [])]
    if (!shown) return { _tag: "Unloaded", sourceTake: integration.sourceTake, load: busy ? disabled("Loading review…") : enabled, notices }
    return { _tag: "Review", sourceTake: integration.sourceTake, review: structuredClone(shown), behaviorReviewed: attested,
      refresh: busy ? disabled("Wait for the current request") : enabled,
      check: busy ? disabled("Checking original and alternate…") : enabled,
      apply: busy ? disabled("Wait for the current request") : shown.checks._tag !== "Passed" ? disabled("Run successful checks for this exact review revision") : !attested ? disabled("Confirm that you reviewed files, product types, interactions, and existing callers. Screenshots alone do not prove these.") : enabled,
      notices,
    }
  }
  const sync = (take: TakeView | null) => {
    if (destroyed) return
    const identityChanged = selected?.take !== take?.take || selected?.created !== take?.created
    const integrationChanged = JSON.stringify(selected?.integration) !== JSON.stringify(take?.integration)
    const runChanged = selected?.run._tag !== take?.run._tag
    if (identityChanged || integrationChanged || (runChanged && take?.run._tag === "Running")) { invalidate(); error = "" }
    selected = take ? structuredClone(take) : null
    if (identityChanged || integrationChanged || runChanged) publish()
  }
  const perform = async (take: string, action: "review" | "check" | "apply", revision?: string): Promise<boolean> => {
    if (destroyed || busy || !available() || selected?.take !== take) return false
    if (action !== "review" && (!revision || !exact(take, revision))) return false
    if (action === "apply" && (!attested || shown?.checks._tag !== "Passed")) return false
    const started = epoch
    busy = true
    attested = false
    error = ""
    publish()
    try {
      // Review/check have no revision field in the existing HTTP schema. Check's
      // response must still match the captured revision before it can authorize apply.
      const result = await request<Review>(`takes/${encodeURIComponent(take)}/${action}`, action === "apply" ? { revision, behaviorReviewed: true } : {})
      if (action === "apply") {
        if (!destroyed && epoch === started) { invalidate(); publish() }
        return true // The write succeeded even if SSE already removed this take.
      }
      if (destroyed || epoch !== started || selected?.take !== take) return false
      if (!Check(ReviewSchema, result)) throw new Error("Caliper received an invalid alternate review snapshot.")
      if (action === "check" && result.revision !== revision) throw new Error("The proposal changed during verification. Refresh review and run checks again.")
      if (shown?.revision !== result.revision) clearDiffs()
      shown = structuredClone(result)
      return true
    } catch (problem) {
      if (!destroyed && epoch === started) { invalidate(); error = message(problem); publish() }
      return false
    } finally {
      if (!destroyed && epoch === started) { busy = false; publish() }
    }
  }
  const mount = (take: string, revision: string, file: string, host: HTMLDivElement | null) => {
    if (destroyed || !exact(take, revision) || !shown?.files.some(change => change.path === file)) return
    if (!host) { hosts.delete(file); diffs.get(file)?.element.remove(); return }
    hosts.set(file, host)
    const attach = () => {
      if (destroyed || !exact(take, revision) || hosts.get(file) !== host || !editor) return
      const change = shown!.files.find(change => change.path === file)!
      let diff = diffs.get(file)
      if (!diff) {
        const element = document.createElement("div")
        diff = { element, ...editor.createDiffView(element, change) }
        diffs.set(file, diff)
      }
      if (diff.element.parentNode !== host) host.append(diff.element)
    }
    if (editor) { attach(); return }
    if (editorProblem) return
    if (!loading) {
      loading = import("../code-editor.js").then(module => { editor = module }, problem => { editorProblem = message(problem) }).finally(() => {
        loading = null
        if (!destroyed) {
          if (selected && shown) for (const [path, node] of hosts) mount(selected.take, shown.revision, path, node)
          publish()
        }
      })
    }
  }
  return {
    sync, getView,
    receive(change: CodeChange) {
      if (destroyed || !selected?.integration || change.take !== null && change.take !== selected.take) return
      // Real-file edits can change the proposal's baseline even outside its file list.
      invalidate(); error = ""; publish()
    },
    review(take: string) { void perform(take, "review") },
    check(take: string, revision: string) { void perform(take, "check", revision) },
    behaviorReviewed(take: string, revision: string, value: boolean) { if (!destroyed && !busy && exact(take, revision) && shown?.checks._tag === "Passed") { attested = value; publish() } },
    apply(take: string, revision: string) { return perform(take, "apply", revision) },
    mountDiff: mount,
    destroy() { destroyed = true; invalidate(); selected = null },
  }
}
