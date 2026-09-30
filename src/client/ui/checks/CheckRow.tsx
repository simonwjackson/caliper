import type { ChromeActions, CheckRow as Row, FindingView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import "../tokens.css"
import "./checks.css"

type Glyph = { readonly mark: string; readonly tone: string; readonly word: string }
export function glyph(status: string): Glyph {
  if (status === "Passed" || status === "Accepted") return { mark: "✓", tone: "ok", word: status === "Accepted" ? "accepted" : "passed" }
  if (status === "Failed") return { mark: "✕", tone: "no", word: "failed" }
  if (status === "NotRun") return { mark: "–", tone: "na", word: "not run" }
  return { mark: "!", tone: "warn", word: status === "Review" ? "needs review" : status === "Stale" ? "out of date" : "inconclusive" }
}

/**
 * One state on one device: a glyph, its name, and the reason on the next
 * line. It unfolds to each finding, the saved renders and, when both renders
 * loaded, the review and approval of the image as a baseline.
 */
export function CheckRow({ run, row, actions, open }: { readonly run: string; readonly row: Row; readonly actions: ChromeActions; readonly open: boolean }) {
  const mark = glyph(row.badge.status)
  const findings: readonly FindingView[] = [...row.findings, ...row.authored]
  return <details className={`dr-check dr-check--${mark.tone}`} data-cal={CAL.checkRow} data-index={row.index} open={open || undefined}>
    <summary className="dr-check__summary">
      <span className={`dr-check__glyph dr-check__glyph--${mark.tone}`} aria-hidden="true">{mark.mark}</span>
      <span className="dr-check__name"><b>{row.state}</b> <span className="dr-check__device">{row.device}</span>{row.take && <span className="dr-check__take"> · take {row.take}</span>}
        <span className="dr-sr">, {row.badge.label}</span></span>
      <span className="dr-check__reason">{row.badge.detail}</span>
    </summary>
    <div className="dr-check__body">
      {findings.length > 0 && <ul className="dr-check__findings">{findings.map(finding => {
        const f = glyph(finding.status)
        const status = finding.status === "NotRun" ? "Not run" : finding.status
        // A finding opens to its detail and evidence.
        return <li key={finding.id} className="dr-finding-item">
          <details className="dr-finding" data-cal={CAL.finding}>
            <summary className="dr-finding__summary">
              <span className={`dr-check__glyph dr-check__glyph--${f.tone}`} aria-hidden="true">{f.mark}</span>
              <span><span className="dr-finding__label">{finding.label}</span><span className="dr-finding__word"> · {status}</span></span>
            </summary>
            {finding.detail && <span className="dr-finding__detail">{finding.detail}</span>}
            {finding.image && <a className="dr-check__shot" href={finding.image.url} target="_blank" rel="noopener" title="Open full size">
              <img data-cal={CAL.evidence} src={finding.image.url} alt={finding.image.label}
                onLoad={() => finding.image && actions.onImageLoaded(run, row.index, finding.image.key)} onError={() => finding.image && actions.onImageFailed(run, row.index, finding.image.key)} />
              <span>{finding.image.caption}</span></a>}
          </details>
        </li>
      })}</ul>}
      {row.authoredSummary && <p className="dr-check__note">{row.authoredSummary}</p>}
      <p className="dr-check__provenance">{row.provenance}</p>
      {row.images.length > 0 && <div className="dr-check__images">{row.images.map(image => <figure key={image.key}>
        <a href={image.url} target="_blank" rel="noopener" title="Open full size"><img data-cal={CAL.evidence} src={image.url} alt={image.label}
          onLoad={() => actions.onImageLoaded(run, row.index, image.key)} onError={() => actions.onImageFailed(run, row.index, image.key)} /></a>
        <figcaption><b>{image.label}</b> {image.caption}</figcaption>
      </figure>)}</div>}
      <div className="dr-check__approve">
        {row.approvalNote && <p className="dr-check__note">{row.approvalNote}</p>}
        <label className="dr-check__reviewed">
          <input type="checkbox" data-cal={CAL.imageReviewed} data-index={row.index} checked={row.reviewed} disabled={row.approved || row.approval._tag === "Disabled"}
            title={row.approval._tag === "Disabled" ? row.approval.reason : undefined} onChange={event => actions.onImageReviewed(run, row.index, event.currentTarget.checked)} />
          <span>I reviewed both renders.</span>
        </label>
        <Button hook={CAL.approveImage} tone={row.reviewed && !row.approved ? "primary" : "plain"}
          availability={row.approved ? { _tag: "Disabled", reason: "This render is the baseline" } : row.reviewed ? row.approval : { _tag: "Disabled", reason: "Review both images first" }}
          onClick={() => actions.onApproveImage(run, row.index)}>{row.approved ? "Baseline approved" : "Approve this image"}</Button>
      </div>
    </div>
  </details>
}
