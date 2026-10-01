import "../tokens.css"
import "./board.css"

/**
 * The board's picker: the columns or rows that do not fit, each with its
 * real label and one press away. Beside the cells it stands as a list. An
 * `action`, such as New row, ends the list: it does something, so it looks
 * like a button, not a choice.
 */
export function BoardPicker({ label, options, value, onPick, vertical = false, action }: {
  readonly label: string; readonly options: readonly { readonly id: string; readonly label: string; readonly title?: string }[]
  readonly value: string | null; readonly onPick: (id: string) => void; readonly vertical?: boolean
  readonly action?: { readonly label: string; readonly title: string; readonly pressed: boolean; readonly hook: string; readonly onPress: () => void }
}) {
  return <div className="ws-picker" data-vertical={vertical || undefined} role="group" aria-label={label}>
    {options.map(option => <button key={option.id} type="button" className="ws-picker__item" aria-pressed={option.id === value}
      title={option.title ?? option.label} onClick={() => onPick(option.id)}>{option.label}</button>)}
    {action && <button type="button" className="ws-picker__item ws-picker__action" data-cal={action.hook} aria-pressed={action.pressed}
      title={action.title} onClick={action.onPress}>{action.label}</button>}
  </div>
}
