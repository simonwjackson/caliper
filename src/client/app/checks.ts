import { Check } from "typebox/value"
import { ChecksViewSchema, type ChecksView as WireChecksView } from "../../checks/contract.js"
import type { Badge, CheckRow, ChecksRun, ChecksView, EvidenceImage, Availability } from "../ui/contract"
import { authoredDetail, canApproveImage, checkDetail, exceptionCountLabel, provenanceDetail, reconcileChecks, summarizeReport, summarizeResult } from "../checks-view.js"

export type ChecksTarget = { part: string; state: string; take?: string; label: string }
type Ready = Extract<WireChecksView, { _tag: "Ready" }>
type Request = <T>(path: string, data?: object) => Promise<T>
const enabled: Availability = { _tag: "Enabled" }
const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
const names = { render: "Rendering", browser: "Browser errors", spill: "Content outside the screen", accessibility: "Accessibility", determinism: "Repeat render", baseline: "Accepted image", expectations: "Product expectations" }
const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem)

/** Effects and saved-evidence identity only. Disclosures, focus and layout belong to UI. */
export function createChecksController({ request, changed, target }: { request: Request; changed: () => void; target: () => ChecksTarget | null }) {
  let wire: WireChecksView = { _tag: "Idle" }
  let opened = false
  let selection: ChecksTarget | null = null
  let busy = false
  let connecting = false
  let error = ""
  let notice = ""
  let epoch = 0
  let refreshId = 0
  let destroyed = false
  const loaded = new Set<string>()
  const failed = new Set<string>()
  const reviewed = new Set<number>()
  const publish = () => { if (!destroyed) changed() }

  const image = (ready: Ready, index: number, kind: EvidenceImage["kind"], checkIndex?: number): EvidenceImage => {
    const result = ready.report.results[index]!
    const authored = checkIndex === undefined ? undefined : result.authored?.checks[checkIndex]
    const evidence = kind === "first" ? [result.png, result.sha256] : kind === "repeat" ? [result.repeatPng, result.repeatSha256] : kind === "authored" ? [authored?.image, authored?.imageSha256] : [result.checks.find(check => check.name === "baseline")?.image]
    const label = kind === "first" ? "First render" : kind === "repeat" ? "Repeat render" : kind === "baseline" ? "Baseline at check time" : `${authored?.name}: interaction evidence`
    return {
      key: JSON.stringify([ready.id, index, result.part, result.state, result.device, result.take, kind, checkIndex, ...evidence]),
      kind, url: `checks/image?id=${encodeURIComponent(ready.id)}&index=${index}&kind=${kind}${checkIndex === undefined ? "" : `&check=${checkIndex}`}`,
      label: `${label}: ${result.part}, ${result.state}, ${result.device}`,
      caption: kind === "authored" ? "Interaction evidence. Not a baseline image." : `${label} · ${result.viewport.width} × ${result.viewport.height}. Open full size.`,
    }
  }
  const eligible = (ready: Ready, index: number): Availability => {
    const result = ready.report.results[index]
    if (!result) return disabled("Result is no longer available")
    if (ready.stale || (ready.report.version === 2 && ready.report.run.stale)) return disabled("Source files changed. Run checks again before approving images.")
    if (result.take !== undefined || ready.request.take !== undefined) return disabled("Take images cannot become product baselines. Accept the take, then check and review the real files.")
    if (ready.approved.includes(index)) return disabled("Baseline already approved")
    if (!canApproveImage(result) || !result.png || !result.repeatPng || !result.sha256 || result.sha256 !== result.repeatSha256) return disabled("Fix render or browser errors and get two matching renders before approving an image.")
    if (busy || connecting) return disabled("Wait for the current request")
    if (!["first", "repeat"].every(kind => loaded.has(image(ready, index, kind as "first" | "repeat").key))) return disabled("Load both saved renders before reviewing them")
    return enabled
  }
  const badge = (part: string, state: string, take?: string): Badge | null => {
    if (wire._tag !== "Ready") return null
    const results = wire.report.results.filter(result => result.part === part && result.state === state && result.take === take)
    if (!results.length) return null
    return resultBadge(wire, summarizeReport(wire.report, results))
  }
  const resultBadge = (ready: Ready, summary: ReturnType<typeof summarizeReport>): Badge => ({ status: ready.stale ? "Stale" : summary.status, label: ready.stale ? "Out of date" : summary.label, detail: summary.detail })
  const rows = (ready: Ready): CheckRow[] => ready.report.results.map((result, index) => {
    const approval = eligible(ready, index)
    const authored = result.authored
    return {
      index, part: result.part, state: result.state, device: result.device, take: result.take ?? null,
      badge: resultBadge(ready, summarizeResult(result)),
      findings: result.checks.map((check, findingIndex) => ({ id: `automatic:${findingIndex}`, label: `${names[check.name]}${check.accepted?.length ? ` · ${exceptionCountLabel(check.accepted.length)}` : ""}`, status: check.status, detail: checkDetail(check) })),
      authored: authored?.checks.map((check, checkIndex) => {
        const shot = check.image && check.imageSha256 ? image(ready, index, "authored", checkIndex) : undefined
        return { id: `authored:${checkIndex}`, label: check.name, status: check.status, detail: authoredDetail(check) + (shot && failed.has(shot.key) ? "\n\nInteraction image unavailable." : ""), ...(shot ? { image: shot } : {}) }
      }) ?? [],
      provenance: authored ? provenanceDetail(authored.provenance) : "This saved report has no authored interaction coverage.",
      authoredSummary: authored ? `Authored interactions · ${authored.status === "NotRun" ? "Not run" : authored.status}: ${authored.reason}` : "This saved report has no authored interaction coverage.",
      images: [image(ready, index, "first"), image(ready, index, "repeat"), ...(result.checks.some(check => check.name === "baseline" && check.image) ? [image(ready, index, "baseline")] : [])].map(shot => ({ ...shot, caption: shot.caption + (failed.has(shot.key) ? " Image unavailable. Run checks again." : "") })),
      approval, reviewed: reviewed.has(index), approved: ready.approved.includes(index),
      approvalNote: approval._tag === "Disabled" ? approval.reason : "Approves visual intent only. Accessibility and other findings remain. Does not accept a take.",
    }
  })
  const getRun = (): ChecksRun => {
    if (connecting && wire._tag === "Idle") return { _tag: "Loading" }
    if (wire._tag === "Idle") return { _tag: "Idle" }
    if (wire._tag === "Running") return { _tag: "Running", id: wire.id, progress: wire.stopping ? "Stopping checks and closing browser work…" : wire.progress ? `${wire.progress.phase}: ${wire.progress.completed} of ${wire.progress.total}.` : `Checking ${wire.total} state/device results…`, stop: wire.stopping || busy || connecting ? disabled("Wait for browser work to stop") : enabled }
    if (wire._tag !== "Ready") return { _tag: wire._tag, reason: wire._tag === "Failed" ? `Checks could not finish. ${wire.reason}` : `Checks stopped. ${wire.reason} No complete visual report was produced.` }
    const ready = wire
    return { _tag: "Ready", id: ready.id, badge: resultBadge(ready, summarizeReport(ready.report)), stale: ready.stale,
      summary: `${ready.report.results.length} state/device results · ${ready.request.take ? `Take ${ready.request.take}` : "Real files"} · ${ready.report.createdAt}`,
      coverage: `${ready.report.coverage}\nBoth device sizes. Covers named scenarios only. Does not block Replace. Only the latest UI run is kept during this server session. Closing or reloading keeps it; restarting Vite clears it. Accepted baselines stay on disk.`,
      runDetail: ready.report.version === 2 ? `Run ended: ${ready.report.run.termination}${ready.report.run.termination !== "Completed" ? ". These are partial observations, not a completed pass." : ""}\nRun ${ready.report.run.id}\nServer ${ready.report.run.source.epoch}\nSource generation ${ready.report.run.source.generation}\nFingerprint ${ready.report.run.source.fingerprint}` : "This saved v1 report has no authored interaction coverage.",
      reportUrl: `checks/report?id=${encodeURIComponent(ready.id)}`, rows: rows(ready),
    }
  }
  const getView = (): ChecksView => {
    if (!opened) return { _tag: "Closed" }
    const availability = !selection ? disabled("No preview selected") : busy || connecting || wire._tag === "Running" ? disabled("Wait for the current checks request") : enabled
    return { _tag: "Open", targetLabel: selection?.label ?? "No preview selected.", runSelected: availability, runAll: availability, run: getRun(), notices: [...(error ? [{ kind: "error" as const, text: error }] : []), ...(notice ? [{ kind: "info" as const, text: notice }] : [])] }
  }
  const receive = (next: WireChecksView) => {
    if (destroyed) return
    if (!Check(ChecksViewSchema, next)) throw new Error("Caliper received an invalid checks snapshot.")
    next = reconcileChecks(wire, structuredClone(next))
    if (JSON.stringify(next) === JSON.stringify(wire)) return
    const sameEvidence = wire._tag === "Ready" && next._tag === "Ready" && wire.id === next.id && JSON.stringify(wire.report) === JSON.stringify(next.report)
    if (!sameEvidence) { loaded.clear(); failed.clear(); reviewed.clear(); notice = "" }
    if (next._tag === "Ready" && next.stale) reviewed.clear()
    wire = next
    epoch++
    publish()
  }
  const refresh = async () => {
    const id = ++refreshId
    const started = epoch
    connecting = true
    publish()
    try {
      const next = await request<WireChecksView>("checks")
      if (!destroyed && id === refreshId && epoch === started) receive(next)
    } catch (problem) { if (!destroyed && id === refreshId && epoch === started) error = message(problem) }
    finally { if (!destroyed && id === refreshId) { connecting = false; publish() } }
  }
  const post = async (action: "run" | "cancel" | "approve", data: object) => {
    if (destroyed || busy || connecting) return
    busy = true
    const started = epoch
    const runId = "id" in wire ? wire.id : null
    error = ""
    notice = ""
    publish()
    try {
      const next = await request<WireChecksView>(`checks/${action}`, data)
      if (destroyed) return
      if (epoch === started) receive(next)
      if (action === "approve" && wire._tag === "Ready" && wire.id === runId) notice = "Baseline approved from these saved images. Other findings remain. Run checks again to compare with it."
    } catch (problem) {
      if (!destroyed && epoch === started) { reviewed.clear(); error = message(problem); void refresh() }
    } finally { if (!destroyed) { busy = false; publish() } }
  }
  const current = (run: string, index: number) => opened && wire._tag === "Ready" && wire.id === run && Number.isInteger(index) && wire.report.results[index] ? wire : null
  const findImage = (run: string, index: number, key: string) => {
    const ready = current(run, index)
    if (!ready) return null
    const row = rows(ready)[index]!
    return [...row.images, ...row.authored.flatMap(finding => finding.image ? [finding.image] : [])].find(shot => shot.key === key) ?? null
  }
  return {
    open() { if (destroyed) return; opened = true; selection = structuredClone(target()); error = ""; publish(); void refresh() },
    close() { if (destroyed) return; opened = false; loaded.clear(); failed.clear(); reviewed.clear(); publish() },
    receive, getView, badge,
    run(scope: "selected" | "all") {
      if (!opened || !selection || wire._tag === "Running" || (scope !== "selected" && scope !== "all")) return
      void post("run", { part: scope === "all" ? "*" : selection.part, state: scope === "all" ? "*" : selection.state, ...(selection.take ? { take: selection.take } : {}) })
    },
    stop(id: string) { if (wire._tag === "Running" && wire.id === id && !wire.stopping) void post("cancel", { id }) },
    imageLoaded(run: string, index: number, key: string) { if (!findImage(run, index, key) || loaded.has(key)) return; loaded.add(key); failed.delete(key); publish() },
    imageFailed(run: string, index: number, key: string) { const shot = findImage(run, index, key); if (!shot) return; loaded.delete(key); failed.add(key); if (shot.kind === "first" || shot.kind === "repeat") reviewed.delete(index); publish() },
    imageReviewed(run: string, index: number, value: boolean) { const ready = current(run, index); if (!ready) return; if (!value) reviewed.delete(index); else if (eligible(ready, index)._tag === "Enabled") reviewed.add(index); publish() },
    approve(run: string, index: number) { const ready = current(run, index); if (ready && reviewed.has(index) && eligible(ready, index)._tag === "Enabled") void post("approve", { id: run, index, reviewed: true }) },
    destroy() { destroyed = true; opened = false; refreshId++; loaded.clear(); failed.clear(); reviewed.clear() },
  }
}
