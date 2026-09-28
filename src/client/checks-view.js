// @ts-check

const TWO_IMAGES = 36
const THREE_IMAGES = 56
const ROOMY_HEIGHT = 24

/**
 * Image comparisons use width for columns; short boxes use less header spacing.
 * All controls remain in the scroll flow. Thresholds are layout estimates.
 * @param {number} width rem in the actual dialog
 * @param {number} height rem in the actual dialog
 */
export function planChecks(width, height) {
  return { columns: width >= THREE_IMAGES ? 3 : width >= TWO_IMAGES ? 2 : 1, compact: height < ROOMY_HEIGHT }
}

/** @typedef {import('../checks/contract.js').ChecksView} ChecksView */
/** HTTP acknowledgements and SSE updates can arrive in either order. @param {ChecksView} current @param {ChecksView} next @returns {ChecksView} */
export function reconcileChecks(current, next) {
  if ((current._tag === "Ready" || current._tag === "Failed") && next._tag === "Running" && current.id === next.id) return current
  if (current._tag === "Ready" && next._tag === "Ready" && current.id === next.id && current.stale) return { ...next, stale: true }
  return next
}

/** @typedef {import('../render/check-contract.js').CheckResult} CheckResult */
/** @param {readonly CheckResult[]} checks */
export function summarizeChecks(checks) {
  const failed = checks.filter(check => check.status === "Failed").length
  const review = checks.filter(check => check.status === "Review").length
  const inconclusive = checks.filter(check => check.status === "Inconclusive").length
  const notRun = checks.filter(check => check.status === "NotRun").length
  const accepted = checks.filter(check => check.status === "Accepted").length
  const exceptions = checks.reduce((count, check) => count + (check.accepted?.length ?? 0), 0)
  const status = failed ? "Failed" : inconclusive ? "Inconclusive" : review ? "Review" : notRun ? "NotRun" : accepted ? "Accepted" : checks.length ? "Passed" : "NotRun"
  const primary = failed ? `${failed} failed` : inconclusive ? `${inconclusive} inconclusive` : review ? `${review} to review` : notRun ? `${notRun} not run` : accepted ? "Accepted" : checks.length ? "Checks passed" : "Not checked"
  const label = exceptions ? `${primary} · ${exceptionCountLabel(exceptions)}` : primary
  const detail = `${failed} failed, ${review} need review, ${inconclusive} inconclusive, ${notRun} not run, ${exceptionCountLabel(exceptions)}. Accepted is not a clean pass. Covers the listed checks only.`
  return { status, label, detail }
}

/** @param {number} count */
export function exceptionCountLabel(count) {
  return `${count} accepted exception${count === 1 ? "" : "s"}`
}

/** Make structured findings readable; keep unexpected formats as text. @param {CheckResult} check */
export function checkDetail(check) {
  const accepted = (check.accepted ?? []).map(item => `Accepted exception: ${item.rule}\nTarget: ${item.target}\nReason: ${item.reason}`)
  const unmatched = (check.unmatched ?? []).map(item => `Unused declaration. Review or remove it: ${item}`)
  return [...accepted, ...unmatched, observedDetail(check)].join("\n\n")
}

/** @param {CheckResult} check */
function observedDetail(check) {
  try {
    const data = JSON.parse(check.detail)
    if (check.name === "accessibility" && Array.isArray(data)) {
      const findings = new Set()
      for (const audit of data) {
        if (audit?._tag === "Unavailable") findings.add(`Audit unavailable: ${audit.reason}`)
        for (const [name, items] of [["Violation", audit?.violations], ["Needs review", audit?.incomplete]]) {
          if (!Array.isArray(items)) continue
          for (const item of items) {
            if (typeof item?.help !== "string" || !Array.isArray(item.nodes)) continue
            const nodes = item.nodes.map((/** @type {{ target: string, summary: string }} */ node) => `${node.target}\n${node.summary}`).join("\n\n")
            findings.add(`${name}: ${item.help}\n${item.id}${item.impact ? ` · ${item.impact}` : ""}\n\n${nodes}\n\n${item.url}`)
          }
        }
      }
      if (findings.size) return [...findings].join("\n\n")
    }
    if (check.name === "browser" && Array.isArray(data) && data.every(item => typeof item === "string")) return [...new Set(data)].join("\n")
    if (check.name === "render" && Array.isArray(data?.problems) && data.problems.length) {
      return data.problems.map((/** @type {{title: string, detail: string}} */ problem) => `${problem.title}\n${problem.detail}`).join("\n\n")
    }
    return JSON.stringify(data, null, 2)
  } catch { return check.detail }
}

/** @param {import('../render/check-contract.js').CheckReport['results'][number]} result */
export function canApproveImage(result) {
  const status = (/** @type {string} */ name) => result.checks.find(check => check.name === name)?.status
  return result.take === undefined && status("determinism") === "Passed" && status("browser") === "Passed"
    && ["Passed", "Review"].includes(status("render") ?? "")
}
