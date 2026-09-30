import type { ChromeActions, ChromeView, CodeView, PlanView } from "../src/client/ui/contract"

export function typeProbes(view: ChromeView, actions: ChromeActions): void {
  actions.onCount(4)
  actions.onMarkPoint("6@1234", { x: 20, y: 30 })
  actions.onMarkRegion("6@1234", { x: 20, y: 30, width: 40, height: 50 })
  actions.onMarkEdit("opaque-mark-id")
  actions.onMarkEdit(null)
  actions.onSend(4)
  // @ts-expect-error Send must capture the draft revision.
  actions.onSend()
  // @ts-expect-error Point coordinates are numeric device CSS px, not CSS lengths.
  actions.onMarkPoint("6@1234", { x: "20px", y: 30 })
  // @ts-expect-error A region needs both dimensions.
  actions.onMarkRegion("6@1234", { x: 20, y: 30, width: 40 })
  if (view.markup._tag === "Ready") {
    // @ts-expect-error UI cannot change core-owned draft groups.
    view.markup.groups.pop()
    const group = view.markup.groups[0]
    if (group) {
      // @ts-expect-error Take creation identity is immutable.
      group.source.created = 999
      const mark = group.marks[0]
      if (mark) {
        // @ts-expect-error Pin geometry is immutable.
        mark.rect.x = 0
        // @ts-expect-error A lost mark must carry a reason.
        const location: typeof mark.location = { _tag: "Lost" }
        void location
      }
    }
  }
  // @ts-expect-error A Sending state has no enabled action to authorize another Send.
  const sending: import("../src/client/ui/contract").MarkupSend = { _tag: "Sending", label: "Sending…", availability: { _tag: "Enabled" } }
  void sending
  actions.onChainHistory("1@100", true)
  actions.onChainSolo("1@100", "Parent")
  // @ts-expect-error The fallback names a side; it is not a toggle.
  actions.onChainSolo("1@100")
  // @ts-expect-error Opening or folding is explicit; there is no toggle.
  actions.onChainHistory("1@100")
  if (view.canvas._tag === "Frames") {
    // @ts-expect-error UI cannot regroup core-owned chains.
    view.canvas.chains.pop()
    const chain = view.canvas.chains[0]
    if (chain) {
      // @ts-expect-error The pair's frames are core-owned.
      chain.parent = null
      // @ts-expect-error A flag must say which accept and why.
      const flag: typeof chain.flag = { _tag: "Before", take: "8" }
      void flag
      if (chain.history._tag === "Open") {
        const step = chain.history.steps[0]
        // @ts-expect-error A discarded step cannot be selected.
        if (step?._tag === "Discarded") void step.selected
      }
    }
  }
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
