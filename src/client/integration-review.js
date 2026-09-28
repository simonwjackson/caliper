// @ts-check
import { h } from "./dom.js"

/** @typedef {ReturnType<ReturnType<typeof import('../takes/integration.js').createIntegrationReview>['review']>} Review */
/** @typedef {import('../types').TakeView} TakeView */

/**
 * Owns the review interaction separately from the streaming conversation.
 * The server binds checks and apply to the exact revision shown here.
 *
 * Each changed file shows as a diff in the code pane's editor, loaded the
 * first time a review arrives.
 *
 * @param {{ openFile?: (file: string) => void }} [hooks]
 *   `openFile` opens a file of the proposal take in the code pane.
 */
export function createIntegrationPanel({ openFile } = {}) {
  const root = document.createElement("section")
  root.className = "cal-integration"
  root.setAttribute("aria-label", "Alternate integration review")
  /** @type {TakeView | null} */
  let selected = null
  /** @type {Review | null} */
  let review = null
  let busy = false
  let error = ""
  let behaviorReviewed = false
  /** @type {typeof import("./code-editor.js") | null} */
  let editor = null
  /** @type {string | null} */
  let editorProblem = null
  /** Diffs built for the review on screen, by path. A re-render moves them, so they keep their scroll. @type {Map<string, { element: HTMLElement, destroy: () => void }>} */
  const diffs = new Map()
  /** The revision the built diffs show. */
  let diffRevision = ""
  /** Files you folded. Every file starts open. @type {Set<string>} */
  const folded = new Set()

  const clearDiffs = () => {
    for (const diff of diffs.values()) diff.destroy()
    diffs.clear()
    diffRevision = ""
  }

  /** @param {Review} shown */
  const fileDiffs = shown => {
    if (shown.revision !== diffRevision) {
      clearDiffs()
      diffRevision = shown.revision
    }
    if (editor === null) {
      if (editorProblem !== null) return [node("p", `Caliper could not load its diff view: ${editorProblem}`)]
      void import("./code-editor.js").then(module => { editor = module }, problem => { editorProblem = problem instanceof Error ? problem.message : String(problem) }).finally(render)
      return [node("p", "Loading the diff…")]
    }
    const module = editor
    return shown.files.map(file => {
      const stat = module.lineChanges(file.before, file.after)
      const detail = h("details", { class: "cal-review-file" },
        h("summary", {},
          h("span", { class: "cal-review-kind" }, file.before === null ? "Add" : "Change"),
          // The folders yield width before the file name does.
          h("code", { class: "cal-review-path", title: file.path },
            h("span", { class: "cal-code-dir" }, file.path.slice(0, file.path.lastIndexOf("/") + 1)),
            h("span", { class: "cal-code-base" }, file.path.slice(file.path.lastIndexOf("/") + 1))),
          h("span", { class: "cal-code-stat", "aria-label": `${stat.added} lines added, ${stat.removed} removed` },
            h("span", { class: "cal-code-added" }, `+${stat.added}`), " ", h("span", { class: "cal-code-removed" }, `−${stat.removed}`)),
          openFile
            ? h("button", {
              type: "button",
              class: "cal-review-open",
              title: `Open ${file.path} in the code pane`,
              onClick: event => {
                // A button in a summary would also fold the file.
                event.preventDefault()
                openFile(file.path)
              },
            }, "Open in Code")
            : null))
      const mount = () => {
        let diff = diffs.get(file.path)
        if (diff === undefined) {
          const element = h("div", { class: "cal-review-diff" })
          diff = { element, ...module.createDiffView(element, file) }
          diffs.set(file.path, diff)
        }
        detail.append(diff.element)
      }
      detail.open = !folded.has(file.path)
      if (detail.open) mount()
      detail.addEventListener("toggle", () => {
        if (detail.open) {
          folded.delete(file.path)
          mount()
        } else {
          folded.add(file.path)
        }
      })
      return detail
    })
  }

  /** @param {string} tag @param {string} text */
  const node = (tag, text) => {
    const element = document.createElement(tag)
    element.textContent = text
    return element
  }
  /** @param {string} text @param {() => void} action */
  const button = (text, action) => {
    const element = document.createElement("button")
    element.type = "button"
    element.textContent = text
    element.disabled = busy
    element.addEventListener("click", action)
    return element
  }
  /** @param {string} action @param {object} [body] */
  const request = async (action, body = {}) => {
    if (!selected || busy) return
    const take = selected.take
    busy = true
    error = ""
    render()
    try {
      const response = await fetch(`takes/${take}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      // A different take can be selected while checks run.
      if (selected?.take !== take) return
      if (action === "apply") {
        review = null
        clearDiffs()
        root.replaceChildren(node("p", "Alternate applied. The source experiment was kept."))
        return
      }
      review = result
      behaviorReviewed = false
    } catch (problem) {
      if (selected?.take === take) error = problem instanceof Error ? problem.message : String(problem)
    } finally {
      busy = false
      render()
    }
  }

  const render = () => {
    root.replaceChildren()
    if (!selected?.integration) return
    root.append(node("h3", "Add an alternate"))
    root.append(node("p", `Proposal take ${selected.take}. Source experiment ${selected.integration.sourceTake} stays separate.`))
    if (selected.run._tag === "Running" || selected.integration._tag === "Preparing") {
      root.append(node("p", selected.run._tag === "Running" ? "The agent is preparing the integration. Real files are unchanged." : "No proposal was submitted. Send a follow-up to finish preparation."))
      return
    }
    root.append(button(busy ? "Working…" : review ? "Refresh review" : "Review changes", () => { void request("review") }))
    if (review) {
      const proposal = review.proposal
      root.append(node("h4", proposal.strategy === "variant" ? "Named component variant" : "Separate component"), node("p", proposal.summary))
      root.append(node("h4", "Shared behavior"), node("p", proposal.shared))
      root.append(node("h4", "Existing callers"), node("p", proposal.preserved))
      root.append(node("h4", "Choose the alternate"), node("pre", proposal.usage))
      root.append(node("p", `Preview: ${proposal.preview.part} · ${proposal.preview.state}. Select this take to see it beside the original.`))
      root.append(node("h4", `${review.files.length} ${review.files.length === 1 ? "file" : "files"} changed`), ...fileDiffs(review))
      const checks = review.checks
      root.append(node("h4", "Verification"))
      root.append(node("p", checks._tag === "Passed" ? checks.summary : checks._tag === "Failed" ? checks.reason : "Render checks have not passed for this revision."))
      root.append(button(busy ? "Checking…" : "Check original and alternate", () => { void request("check") }))
      root.append(node("p", "Checks render all existing states twice, compare the proposal, and render the alternate on each device. Animations can make the result inconclusive. This can take several minutes."))
      const confirm = document.createElement("label")
      const input = document.createElement("input")
      input.type = "checkbox"
      input.checked = behaviorReviewed
      input.disabled = busy || checks._tag !== "Passed"
      const apply = button("Apply reviewed alternate", () => {
        if (review && behaviorReviewed) void request("apply", { revision: review.revision, behaviorReviewed: true })
      })
      apply.disabled = busy || checks._tag !== "Passed" || !behaviorReviewed
      input.addEventListener("change", () => { behaviorReviewed = input.checked; apply.disabled = busy || checks._tag !== "Passed" || !behaviorReviewed })
      confirm.append(input, " I reviewed the files and verified product types, interactions, and existing callers. Screenshots alone do not prove these.")
      root.append(confirm, apply)
    }
    if (error) {
      const notice = node("p", error)
      notice.setAttribute("role", "alert")
      root.append(notice)
    }
  }

  /** @param {TakeView | null} take */
  return take => {
    const identityChanged = selected?.take !== take?.take || selected?.created !== take?.created
    if (identityChanged || (selected?.run._tag !== "Running" && take?.run._tag === "Running")) {
      review = null
      behaviorReviewed = false
      error = ""
      clearDiffs()
      folded.clear()
    }
    const changed = identityChanged || selected?.run._tag !== take?.run._tag || JSON.stringify(selected?.integration) !== JSON.stringify(take?.integration)
    selected = take
    if (changed || root.childNodes.length === 0) render()
    return root
  }
}
