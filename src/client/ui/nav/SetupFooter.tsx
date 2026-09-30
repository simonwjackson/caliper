import type { SetupRow } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./nav.css"

/** A label inside a sentence: "Entry" reads "entry", but "CSS" stays "CSS". */
const sentence = (label: string) => label === label.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1)

/** One line at the foot of the parts panel. It unfolds to each derived value, its source and its problems (decision 3). */
export function SetupFooter({ rows, problems }: { readonly rows: readonly SetupRow[]; readonly problems: readonly string[] }) {
  const failed = rows.filter(row => row.status === "Failed")
  const bad = failed.length > 0 || problems.length > 0
  const summary = bad
    ? `Setup: ${[...failed.map(row => sentence(row.label)), ...(problems.length ? [`${problems.length} ${problems.length === 1 ? "problem" : "problems"}`] : [])].join(", ")} to fix`
    : "Setup"
  return <details className="dr-setup" data-cal={CAL.setup} open={bad || undefined}>
    <summary className="dr-setup__summary"><i className={`dr-dot ${bad ? "dr-dot--bad" : "dr-dot--good"}`} aria-hidden="true" /><span>{summary}</span><i className="dr-chev" aria-hidden="true" /></summary>
    <div className="dr-setup__rows">
      {problems.map(problem => <p key={problem} className="dr-setup__problem" role="alert">{problem}</p>)}
      {rows.map(row => <section key={row.label} className="dr-setup__row" data-status={row.status}>
        <h4><span>{row.label}</span><span className="dr-setup__status">{row.status === "Derived" ? "found" : row.status === "Overridden" ? "set in vite.config" : "not found"}</span></h4>
        {row.values.map(value => <code key={value}>{value}</code>)}
        <p className="dr-setup__from">{row.provenance}</p>
        {row.problems.map(problem => <p key={problem} className="dr-setup__problem" role="alert">{problem}</p>)}
      </section>)}
    </div>
  </details>
}
