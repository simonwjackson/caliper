import type { ChromeActions, ChromeView, CodeView, PlanView } from "../src/client/ui/contract"

export function typeProbes(view: ChromeView, actions: ChromeActions): void {
  actions.onCount(4)
  actions.onDirection("stable-id", "brief", "Use a quieter button")
  actions.onKnobCommit("gap", "12px")
  actions.onApplyAlternate("6", "reviewed-revision")
  if (view.plan._tag === "Review") actions.onRemoveDirection(view.plan.directions[0]?.id ?? "missing")
  // @ts-expect-error Five takes violates the supported count.
  actions.onCount(5)
  // @ts-expect-error Renderers cannot mutate the app-owned snapshot.
  view.composer.prompt = "changed"
  // @ts-expect-error Imported device objects are also part of the immutable snapshot.
  view.device.cssWidth = 1
  if (view.record._tag === "Open" && view.record.integration._tag === "Review") {
    // @ts-expect-error Review files cannot be changed by the renderer.
    view.record.integration.review.files.pop()
    // @ts-expect-error Reviewed source text cannot be changed by the renderer.
    view.record.integration.review.files[0]!.after = "changed"
  }
  if (view.code._tag === "Ready") {
    // @ts-expect-error Imported editor mode cannot be changed by the renderer.
    view.code.mode._tag = "Real"
  }
  // @ts-expect-error A callback cannot omit the exact review revision.
  actions.onApplyAlternate("6")
  // @ts-expect-error The local contract cannot expose raw untagged loading flags.
  const plan: PlanView = { loading: true, directions: [] }
  // @ts-expect-error Failed code does not carry a Ready document.
  const code: CodeView = { _tag: "Failed", document: { file: "x", content: "" } }
  void plan; void code
}
