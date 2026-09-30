import type { ChromeActions, LiteralView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import "../tokens.css"
import "./side.css"

/**
 * One literal that could be a token (decision 30). Make a token opens a form
 * with the suggested name and home; the form says both edits before Caliper
 * makes them, and Create token makes them together.
 */
export function Literal({ literal, actions }: { readonly literal: LiteralView; readonly actions: ChromeActions }) {
  const draft = literal.draft
  const open = draft._tag !== "Closed"
  const saving = draft._tag === "Saving"
  return <li className="dr-literal" data-cal={CAL.literal} data-literal={literal.id}>
    <div className="dr-literal__row">
      <span className="dr-literal__what"><code>{literal.property}: {literal.value}</code>
        <span className="dr-literal__where">{literal.selector} · <button type="button" className="dr-knob__source" data-cal={CAL.sourceFile} data-file={literal.source.file}
          onClick={() => actions.onOpenFile(literal.source.file)}>{literal.source.file.split("/").at(-1)}:{literal.source.line}</button></span>
      </span>
      <button type="button" className="dr-btn" data-cal={CAL.literalOpen} data-literal={literal.id} aria-expanded={open}
        onClick={() => actions.onLiteralDraft(literal.id, !open)}>Make a token</button>
    </div>
    {draft._tag !== "Closed" && <form className="dr-literal__form" data-literal={literal.id} aria-label={`Make ${literal.property}: ${literal.value} a token`}
      onSubmit={event => { event.preventDefault(); if (draft.create._tag === "Enabled") actions.onPromote(literal.id) }}>
      <label><span>Name</span><input data-cal={CAL.literalName} data-literal={literal.id} value={draft.name} disabled={saving} spellCheck={false}
        onChange={event => actions.onLiteralName(literal.id, event.currentTarget.value)} /></label>
      <label><span>Goes in</span><select data-cal={CAL.literalHome} data-literal={literal.id} value={draft.home} disabled={saving}
        onChange={event => actions.onLiteralHome(literal.id, event.currentTarget.value)}>
        {literal.homes.map(home => <option key={home.id} value={home.id}>{home.label}</option>)}
      </select></label>
      <p className="dr-literal__preview">{draft.preview}</p>
      {draft.problem && <p className="dr-literal__problem" role="alert">{draft.problem}</p>}
      <div className="dr-literal__actions">
        <button type="button" className="dr-btn" data-cal={CAL.literalCancel} data-literal={literal.id} disabled={saving} onClick={() => actions.onLiteralDraft(literal.id, false)}>Cancel</button>
        <Button hook={CAL.promote} tone="primary" availability={draft.create} onClick={() => actions.onPromote(literal.id)}>{saving ? "Creating…" : "Create token"}</Button>
      </div>
    </form>}
  </li>
}
