import { useRef } from "react"
import type { ChromeActions, CodeView } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./code.css"

type Ready = Extract<CodeView, { _tag: "Ready" }>

function group(depth: number | null): string {
  if (depth === null) return "Changed, not imported by this part"
  if (depth === 0) return "The part"
  if (depth === 1) return "Imported by the part"
  return `Imported ${depth} steps away`
}

/**
 * Every file of the editing subject, as the take sees it, grouped by how far
 * the part imports it. The filter narrows the list; choosing a file opens it
 * and closes the menu. Escape closes it and returns focus to its button.
 */
export function FilesMenu({ code, actions }: { readonly code: Ready; readonly actions: ChromeActions }) {
  const details = useRef<HTMLDetailsElement>(null)
  const filter = code.filter.toLowerCase()
  const shown = code.files.filter(file => file.file.toLowerCase().includes(filter))
  const groups = [...new Set(shown.map(file => file.depth))].sort((a, b) => (a ?? 99) - (b ?? 99))
  const close = () => { const node = details.current; if (node) { node.open = false; node.querySelector("summary")?.focus() } }
  return <details ref={details} className="dr-files" data-cal={CAL.fileMenu} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close() } }}>
    <summary className="dr-files__summary">Files · {code.files.length}<i className="dr-chev dr-chev--down" aria-hidden="true" /></summary>
    <div className="dr-files__menu">
      <input type="search" className="dr-files__filter" data-cal={CAL.fileFilter} aria-label="Filter files" placeholder="Filter files" value={code.filter}
        onChange={event => actions.onFileFilter(event.currentTarget.value)} />
      {shown.length === 0 && <p className="dr-files__empty">No file matches.</p>}
      {groups.map(depth => <section key={String(depth)} aria-label={group(depth)}>
        <h4>{group(depth)}</h4>
        <ul>{shown.filter(file => file.depth === depth).map(file => <li key={file.file}>
          <button type="button" className="dr-files__file" data-cal={CAL.file} data-file={file.file} aria-current={file.file === code.selectedFile || undefined}
            onClick={() => { actions.onOpenFile(file.file); close() }}>
            <span>{file.file}</span>
            {file.changed && <span className="dr-code__stat"><span className="dr-code__added">+{file.added ?? 0}</span> <span className="dr-code__removed">−{file.removed ?? 0}</span></span>}
          </button>
        </li>)}</ul>
      </section>)}
    </div>
  </details>
}
