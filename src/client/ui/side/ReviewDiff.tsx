import { useCallback } from "react"
import type { ChromeActions } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./side.css"

/** Core mounts a read-only diff in this host, for this take, revision and file. */
export function ReviewDiff({ take, revision, file, actions }: { readonly take: string; readonly revision: string; readonly file: string; readonly actions: ChromeActions }) {
  const { onReviewDiffMount } = actions
  const mount = useCallback((host: HTMLDivElement | null) => onReviewDiffMount(take, revision, file, host), [onReviewDiffMount, take, revision, file])
  return <div className="dr-integration__diff" data-cal={CAL.reviewDiff} data-file={file} ref={mount} />
}
