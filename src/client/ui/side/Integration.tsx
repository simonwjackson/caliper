import type { ChromeActions, IntegrationView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Notices } from "../atoms/Notices"
import { ReviewDiff } from "./ReviewDiff"
import "../tokens.css"
import "./side.css"

/**
 * Review of an alternate at the foot of its record. Everything binds to the
 * exact revision under review: the diff hosts, the check, the attestation and
 * Apply. Apply stays disabled until checks pass for this revision and you say
 * you verified the behaviour that screenshots cannot show.
 */
export function Integration({ take, view, actions }: { readonly take: string; readonly view: IntegrationView; readonly actions: ChromeActions }) {
  if (view._tag === "None") return null
  return <section className="dr-integration" data-cal={CAL.integration} data-take={take} aria-label="Alternate review">
    <h3>Review alternate</h3>
    <p className="dr-integration__source">Take {view.sourceTake} stays as it is; this alternate is a separate take.</p>
    {view._tag === "Preparing" ? <><p role="status">{view.message}</p><div className="dr-working" aria-hidden="true" /></> : <>
      <div className="dr-integration__row">
        <Button hook={CAL.review} take={take} availability={view._tag === "Review" ? view.refresh : view.load} onClick={() => actions.onReview(take)}>{view._tag === "Review" ? "Refresh the review" : "Review changes"}</Button>
      </div>
      <Notices notices={view.notices} />
      {view._tag === "Review" && <>
        <dl className="dr-integration__proposal">
          <dt>Strategy</dt><dd>{view.review.proposal.strategy}. {view.review.proposal.summary}</dd>
          <dt>Shared</dt><dd>{view.review.proposal.shared}</dd>
          <dt>Callers</dt><dd>{view.review.proposal.preserved}</dd>
          <dt>Use</dt><dd><code>{view.review.proposal.usage}</code></dd>
          <dt>Preview</dt><dd>{view.review.proposal.preview.part} · {view.review.proposal.preview.state}</dd>
        </dl>
        {view.review.files.map(file => <details key={`${view.review.revision}:${file.path}`} className="dr-integration__file" open>
          <summary><code>{file.path}</code><i className="dr-chev" aria-hidden="true" /></summary>
          <Button hook={CAL.file} file={file.path} small onClick={() => actions.onOpenFile(file.path)}>Open in Code</Button>
          <ReviewDiff take={take} revision={view.review.revision} file={file.path} actions={actions} />
        </details>)}
        <p className={`dr-integration__checks dr-integration__checks--${view.review.checks._tag}`} role="status">
          {view.review.checks._tag === "Passed" ? view.review.checks.summary : view.review.checks._tag === "Failed" ? view.review.checks.reason : "Render checks have not run for this revision."}
        </p>
        <div className="dr-integration__row">
          <Button hook={CAL.integrationCheck} take={take} availability={view.check} onClick={() => actions.onIntegrationCheck(take, view.review.revision)}>Check original and alternate</Button>
        </div>
        <label className="dr-integration__attest">
          <input type="checkbox" data-cal={CAL.behaviorReviewed} data-take={take} checked={view.behaviorReviewed}
            disabled={view.review.checks._tag !== "Passed" || view.check._tag === "Disabled"}
            onChange={event => actions.onBehaviorReviewed(take, view.review.revision, event.currentTarget.checked)} />
          <span>I verified product types, interactions and callers. Screenshots alone do not prove these.</span>
        </label>
        <div className="dr-integration__row">
          <Button hook={CAL.applyAlternate} take={take} tone="primary" availability={view.apply} onClick={() => actions.onApplyAlternate(take, view.review.revision)}>Apply reviewed alternate</Button>
          <span className="dr-integration__revision">revision {view.review.revision}</span>
        </div>
      </>}
    </>}
  </section>
}

