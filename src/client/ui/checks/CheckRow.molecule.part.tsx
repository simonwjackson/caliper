import { CheckRow } from "./CheckRow"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { checksView } from "../fixtures/views"

export const name = "Check row"
export const note = "One state on one device: a glyph, the reason, and on unfolding its findings and renders."

function Row({ index, open }: { readonly index: number; readonly open: boolean }) {
  const { view, actions } = useFixture(checksView)
  const run = view.checks._tag === "Open" && view.checks.run._tag === "Ready" ? view.checks.run : null
  const row = run?.rows.find(item => item.index === index)
  return <PartScope width="40rem">{run && row && <CheckRow run={run.id} row={row} actions={actions} open={open} />}</PartScope>
}
export default function Failed() { return <Row index={0} open /> }
export function Approve() { return <Row index={2} open /> }
export function Passed() { return <Row index={1} open={false} /> }
