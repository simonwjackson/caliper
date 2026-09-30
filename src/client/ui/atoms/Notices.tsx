import type { Notice } from "../contract"
import "../tokens.css"
import "./atoms.css"

/** Errors are alerts; warnings and information are polite status lines. */
export function Notices({ notices }: { readonly notices: readonly Notice[] }) {
  if (notices.length === 0) return null
  return <ul className="dr-notices">{notices.map((notice, index) =>
    <li key={`${index}:${notice.text}`} className={`dr-notice dr-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</li>)}
  </ul>
}
