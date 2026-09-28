// @ts-check
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Check } from "typebox/value"
import { BaselineSchema, CheckReportSchema } from "./check-contract.js"
import { renderJobs } from "./render.js"
import { applyExpectations } from "./expectations.js"

/** @typedef {import("./render.js").RenderResult} RenderResult */
/** @typedef {import("./check-contract.js").CheckResult} CheckResult */
/** @typedef {import("./check-contract.js").CheckReport} CheckReport */

const COVERAGE = "Only the listed states and devices were checked. These observations do not prove interactions, hermeticity, unchanged sources during the run, or coverage of undeclared consumers."

/**
 * Render twice in fresh browser contexts. Unique run folders retain both images
 * for review and prevent concurrent runs from replacing each other's evidence.
 * @param {{ url: string, project: string, jobs: readonly import("./plan.js").RenderJob[], out: string, executablePath: string, baselines?: string }} input
 */
export async function checkJobs({ url, project, jobs, out, executablePath, baselines }) {
  if (jobs.length === 0) throw new Error("No states selected for checks.")
  if (new Set(jobs.map(job => JSON.stringify(job))).size !== jobs.length) throw new Error("Duplicate render jobs in check request.")
  mkdirSync(out, { recursive: true })
  const run = mkdtempSync(join(resolve(out), "check-"))
  const first = await renderJobs({ url, jobs, out: join(run, "first"), executablePath, audit: true })
  const second = await renderJobs({ url, jobs, out: join(run, "repeat"), executablePath, audit: true })
  const report = compareRenders({ project, first, second, ...(baselines === undefined ? {} : { baselines }) })
  const reportPath = join(run, "report.json")
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  const results = first.map((result, index) => ({ ...result, checks: report.results[index]?.checks ?? [], checkReport: reportPath }))
  return { results, report, reportPath }
}

/**
 * Classify actual render observations. Empty and spill need human judgement;
 * a detected issue and an unavailable check are different results.
 * @param {{ project: string, first: RenderResult[], second: RenderResult[], baselines?: string }} input
 * @returns {CheckReport}
 */
export function compareRenders({ project, first, second, baselines }) {
  const key = (/** @type {RenderResult} */ result) => JSON.stringify([result.part, result.state, result.device, result.take])
  const repeats = new Map(second.map(result => [key(result), result]))
  if (!first.length || repeats.size !== second.length || new Set(first.map(key)).size !== first.length
    || first.length !== second.length || first.some(result => !repeats.has(key(result)))) {
    throw new Error("The two renders must cover the same nonempty set of states, devices and takes without duplicates.")
  }
  const environment = first[0]?.environment
  if (!environment || [...first, ...second].some(result => result.environment !== environment)) {
    throw new Error("The render environment is missing or changed between samples.")
  }
  const results = first.map(result => {
    const repeat = /** @type {RenderResult} */ (repeats.get(key(result)))
    const samples = [result, repeat]
    const sha256 = digest(readFileSync(result.png))
    const repeatSha256 = digest(readFileSync(repeat.png))
    const failures = samples.flatMap(sample => sample.problems.filter(problem => !emptyWarning(sample, problem)))
    const broken = samples.some(sample => sample.frame === "Failed") || failures.length > 0
    const errors = samples.flatMap(sample => sample.console)
    const spills = samples.flatMap(sample => sample.spill ? [sample.spill] : [])
    const stable = result.frame === repeat.frame && sha256 === repeatSha256 && JSON.stringify(result.viewport) === JSON.stringify(repeat.viewport)
    /** @type {CheckResult[]} */
    const checks = [
      { name: "render", status: broken ? "Failed" : samples.some(sample => sample.frame === "Empty") ? "Review" : "Passed",
        detail: broken ? JSON.stringify({ frames: samples.map(sample => sample.frame), problems: failures }) : samples.some(sample => sample.frame === "Empty") ? "Rendered no content. Review whether this state is intentionally empty." : "Both samples rendered visible content." },
      { name: "browser", status: errors.length ? "Failed" : "Passed", detail: errors.length ? JSON.stringify(errors) : "No browser errors observed in either sample." },
      { name: "spill", status: spills.length ? "Review" : broken ? "Inconclusive" : "Passed", detail: spills.length ? `Content extends outside the viewport. Scrolling can be intentional: ${JSON.stringify(spills)}` : broken ? "The intended content did not render correctly; its layout cannot be checked." : "No measured spill in either sample." },
      accessibilityCheck(samples, broken),
      { name: "determinism", status: broken || errors.length ? "Inconclusive" : stable ? "Passed" : "Inconclusive",
        detail: broken || errors.length ? "Broken renders cannot establish determinism." : stable ? "Two screenshot byte sequences and frame verdicts match. This is a sample, not proof of determinism." : "The two renders differ. Review both images; animation or changing data can cause this." },
    ]
    applyExpectations(samples, checks, broken)
    const candidate = { part: result.part, state: result.state, device: result.device, frame: result.frame, viewport: result.viewport, sha256 }
    checks.push(checkBaseline(project, environment, candidate, baselines, checks.find(check => check.name === "determinism")?.status === "Passed"))
    return { ...candidate, ...(result.take === undefined ? {} : { take: result.take }), png: resolve(result.png), repeatPng: resolve(repeat.png), repeatSha256, checks }
  })
  return { version: 1, project, environment, createdAt: new Date().toISOString(), coverage: COVERAGE, results }
}

/** @param {RenderResult} sample @param {import("./render.js").Problem} problem */
function emptyWarning(sample, problem) {
  return sample.frame === "Empty" && problem.kind === "warning"
    && problem.title === `${sample.part} rendered nothing: its component returned null or an empty tree.` && problem.detail === ""
}

/** @param {RenderResult[]} samples @param {boolean} broken @returns {CheckResult} */
function accessibilityCheck(samples, broken) {
  const audits = samples.map(sample => sample.accessibility)
  const findings = audits.flatMap(audit => audit?._tag === "Complete" ? audit.violations : [])
  const incomplete = audits.flatMap(audit => audit?._tag === "Complete" ? audit.incomplete : [])
  const unavailable = audits.some(audit => audit?._tag !== "Complete")
  return {
    name: "accessibility",
    status: findings.length ? "Failed" : unavailable || broken ? "Inconclusive" : incomplete.length ? "Review" : "Passed",
    detail: broken ? `The intended content did not render correctly. Audit observations: ${JSON.stringify(audits)}` : findings.length || incomplete.length || unavailable ? JSON.stringify(audits)
      : "No axe WCAG A/AA violations found in the product host. Keyboard behavior and full-page accessibility still need review.",
  }
}

/** @param {Buffer | string} content */
const digest = content => createHash("sha256").update(content).digest("hex")
/** @param {string} project @param {{ part: string, state: string, device: string }} result */
const baselineKey = (project, result) => digest(JSON.stringify([project, result.part, result.state, result.device]))

/**
 * @param {string} project
 * @param {string} environment
 * @param {Omit<import("./check-contract.js").Baseline, "version" | "project" | "environment">} result
 * @param {string | undefined} directory
 * @param {boolean} stable
 * @returns {CheckResult}
 */
function checkBaseline(project, environment, result, directory, stable) {
  if (!stable) return { name: "baseline", status: "Inconclusive", detail: "A broken or unstable render cannot be compared with an accepted image." }
  if (!directory) return { name: "baseline", status: "NotRun", detail: "No baseline directory supplied." }
  const file = join(directory, `${baselineKey(project, result)}.json`)
  if (!existsSync(file)) return { name: "baseline", status: "Review", detail: "No accepted baseline. Inspect the images before approving this report." }
  try {
    const baseline = JSON.parse(readFileSync(file, "utf8"))
    if (!Check(BaselineSchema, baseline)) throw new Error("Invalid baseline record.")
    if (baseline.project !== project || baseline.part !== result.part || baseline.state !== result.state || baseline.device !== result.device) throw new Error("Baseline identity does not match.")
    const png = join(directory, `${baseline.sha256}.png`)
    if (digest(readFileSync(png)) !== baseline.sha256) throw new Error("Baseline image changed.")
    if (baseline.environment !== environment) return { name: "baseline", status: "Inconclusive", image: png, detail: `Baseline browser/platform/check version differs. Review a new baseline. Previous image: ${png}` }
    const equal = baseline.sha256 === result.sha256 && baseline.frame === result.frame && JSON.stringify(baseline.viewport) === JSON.stringify(result.viewport)
    return { name: "baseline", status: equal ? "Passed" : "Review", image: png, detail: equal ? `Matches accepted image: ${png}` : `Image or frame verdict changed. Review the accepted image: ${png}` }
  } catch (error) {
    return { name: "baseline", status: "Inconclusive", detail: `Cannot read baseline: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Approve the saved evidence, never a fresh unreviewed render. This records visual
 * intent only; it does not suppress other checks or authorize accepting a take.
 * @param {string} reportPath
 * @param {string} directory
 */
export function approveBaselines(reportPath, directory) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  if (!Check(CheckReportSchema, report)) throw new Error("Invalid check report.")
  const keys = new Set()
  const entries = report.results.map(result => {
    const key = baselineKey(report.project, result)
    if (keys.has(key)) throw new Error("Duplicate state/device in report.")
    keys.add(key)
    if (result.take !== undefined) throw new Error("Take images cannot become product baselines. Accept the take, then check and review the real files.")
    const passed = (/** @type {string} */ name) => result.checks.filter(check => check.name === name).length === 1
      && result.checks.find(check => check.name === name)?.status === "Passed"
    if (result.frame === "Failed" || !passed("determinism") || !passed("browser")
      || result.checks.filter(check => check.name === "render").length !== 1
      || !["Passed", "Review"].includes(result.checks.find(check => check.name === "render")?.status ?? "")) {
      throw new Error(`Cannot approve broken or unstable render: ${result.part} ${result.state} ${result.device}.`)
    }
    const bytes = readFileSync(result.png)
    if (digest(bytes) !== result.sha256 || digest(readFileSync(result.repeatPng)) !== result.repeatSha256 || result.sha256 !== result.repeatSha256) {
      throw new Error("Report images changed or do not match. Run checks and review again.")
    }
    const baseline = { version: 1, project: report.project, environment: report.environment, part: result.part, state: result.state, device: result.device, frame: result.frame, viewport: result.viewport, sha256: result.sha256 }
    return { key, baseline, bytes }
  })
  // Validate every image before modifying any accepted record. Individual records
  // are atomic; interrupted multi-state approval can leave only some updated.
  mkdirSync(directory, { recursive: true })
  for (const { key, baseline, bytes } of entries) {
    atomicWrite(join(directory, `${baseline.sha256}.png`), bytes)
    atomicWrite(join(directory, `${key}.json`), `${JSON.stringify(baseline, null, 2)}\n`)
  }
  return { approved: entries.length, baselines: resolve(directory), scope: "Visual baselines only. Other findings remain, and Replace is unchanged." }
}

/** @param {string} file @param {string | Buffer} content */
function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, file)
}
