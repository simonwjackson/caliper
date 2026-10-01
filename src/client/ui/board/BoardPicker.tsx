import "../tokens.css"
import "./board.css"

/**
 * The board's picker: the columns or rows that do not fit, each with its
 * real label and one press away. Beside the cells it stands as a list.
 */
export function BoardPicker({ label, options, value, onPick, vertical = false }: {
  readonly label: string; readonly options: readonly { readonly id: string; readonly label: string; readonly title?: string }[]
  readonly value: string | null; readonly onPick: (id: string) => void; readonly vertical?: boolean
}) {
  return <div className="ws-picker" data-vertical={vertical || undefined} role="group" aria-label={label}>
    {options.map(option => <button key={option.id} type="button" className="ws-picker__item" aria-pressed={option.id === value}
      title={option.title ?? option.label} onClick={() => onPick(option.id)}>{option.label}</button>)}
  </div>
}
